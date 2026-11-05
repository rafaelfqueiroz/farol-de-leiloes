import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { isValid, parseISO } from 'date-fns';
import { CouponEntity, CouponDocument } from './schemas/coupon.schema';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { Coupon } from './interfaces/coupon.interface';
import { DomainError } from '../common/errors/domain-error';
import { Clock } from '../common/clock/clock';
import { endOfBrasiliaDay, inBrasilia, startOfBrasiliaDay } from '../common/clock/brasilia-time';
import { fromDecimal128, toDecimal128 } from '../common/money/decimal128';
import { PaymentGateway } from '../payments/payment-gateway';
import { logSafeError } from '../common/errors/log-safe-error';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated';

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    @InjectModel(CouponEntity.name) private readonly couponModel: Model<CouponDocument>,
    // AR-10: Stripe through its port; the adapter turns reais into centavos (AR-20).
    private readonly paymentGateway: PaymentGateway,
    private readonly clock: Clock, // AR-24
  ) {}

  async create(dto: CreateCouponDto): Promise<Coupon> {
    // AR-23 / #83: "valid to D" means through the end of day D in Brasília, so a bare YYYY-MM-DD
    // is 23:59:59.999 there; a full ISO instant keeps the caller's own instant.
    const parsed = new Date(parseISO(dto.validTo, { in: inBrasilia }).getTime());
    const validTo =
      BARE_DATE.test(dto.validTo) && isValid(parsed) ? endOfBrasiliaDay(parsed) : parsed;
    // AR-24: "today or later" is today in Brasília, by the injected clock (moved here from the DTO,
    // whose validator read the host's clock and zone).
    if (!isValid(validTo) || validTo < startOfBrasiliaDay(this.clock.now())) {
      throw new DomainError('VALIDATION_FAILED', { fields: ['validTo'] });
    }

    const code = dto.code.toUpperCase();
    const discount = await this.paymentGateway.createFixedDiscount({
      code,
      amountOff: dto.discountValue,
      expiresAt: validTo,
    });

    const coupon = new this.couponModel({
      code,
      // AR-17: reais as Decimal128.
      discountValue: toDecimal128(dto.discountValue),
      validTo,
      description: dto.description,
      stripeCouponId: discount.couponId,
      stripePromotionCodeId: discount.promotionCodeId,
      active: true,
    });

    const saved = await coupon.save();
    return this.toCoupon(saved);
  }

  /** AR-35: one page of every coupon, newest first (`_id` breaks createdAt ties). */
  async findPage(page: PageRequest): Promise<Paginated<Coupon>> {
    const [total, docs] = await Promise.all([
      this.couponModel.countDocuments().exec(),
      this.couponModel
        .find()
        .sort({ createdAt: -1, _id: -1 })
        .skip(skipOf(page))
        .limit(page.pageSize)
        .exec(),
    ]);
    return paginated(
      docs.map((doc) => this.toCoupon(doc)),
      total,
      page,
    );
  }

  async validateCoupon(code: string): Promise<Coupon> {
    const coupon = await this.couponModel.findOne({ code: code.toUpperCase() }).exec();

    // AR-24: expiry against the injected clock.
    if (!coupon || !coupon.active || coupon.validTo < this.clock.now()) {
      throw new DomainError('COUPON_INVALID');
    }

    return this.toCoupon(coupon);
  }

  async invalidate(id: string): Promise<Coupon> {
    const coupon = await this.couponModel.findById(id).exec();

    if (!coupon) {
      throw new DomainError('COUPON_NOT_FOUND');
    }

    // Deactivate the promotion code at the provider
    if (coupon.stripePromotionCodeId) {
      try {
        await this.paymentGateway.deactivatePromotionCode(coupon.stripePromotionCodeId);
      } catch (error) {
        this.logger.warn(`Failed to deactivate Stripe promotion code: ${logSafeError(error)}`);
      }
    }

    coupon.active = false;
    const saved = await coupon.save();
    return this.toCoupon(saved);
  }

  private toCoupon(doc: CouponDocument): Coupon {
    return {
      _id: doc._id.toString(),
      code: doc.code,
      discountValue: fromDecimal128(doc.discountValue),
      validTo: doc.validTo,
      active: doc.active,
      stripeCouponId: doc.stripeCouponId ?? null,
      stripePromotionCodeId: doc.stripePromotionCodeId ?? null,
      description: doc.description ?? null,
      createdAt: doc.createdAt,
    };
  }
}
