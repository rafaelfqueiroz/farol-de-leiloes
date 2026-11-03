import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { CouponEntity, CouponDocument } from './schemas/coupon.schema';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { Coupon } from './interfaces/coupon.interface';
import { DomainError } from '../common/errors/domain-error';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated';

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);
  private stripe: Stripe;

  constructor(
    @InjectModel(CouponEntity.name) private readonly couponModel: Model<CouponDocument>,
    configService: ConfigService<Env, true>,
  ) {
    // AR-41: the key is required at boot.
    this.stripe = new Stripe(configService.get('STRIPE_SECRET_KEY', { infer: true }));
  }

  async create(dto: CreateCouponDto): Promise<Coupon> {
    // Create Stripe coupon with absolute amount off
    const stripeCoupon = await this.stripe.coupons.create({
      amount_off: dto.discountValue,
      currency: 'brl',
      duration: 'once',
      name: dto.code,
    });

    // Create Stripe promotion code (user-facing code)
    const promoCode = await this.stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon: stripeCoupon.id },
      code: dto.code.toUpperCase(),
      expires_at: Math.floor(new Date(dto.validTo).getTime() / 1000),
      active: true,
    });

    const coupon = new this.couponModel({
      code: dto.code.toUpperCase(),
      discountValue: dto.discountValue,
      validTo: new Date(dto.validTo),
      description: dto.description,
      stripeCouponId: stripeCoupon.id,
      stripePromotionCodeId: promoCode.id,
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

    if (!coupon || !coupon.active || new Date(coupon.validTo) < new Date()) {
      throw new DomainError('COUPON_INVALID');
    }

    return this.toCoupon(coupon);
  }

  async invalidate(id: string): Promise<Coupon> {
    const coupon = await this.couponModel.findById(id).exec();

    if (!coupon) {
      throw new DomainError('COUPON_NOT_FOUND');
    }

    // Deactivate promotion code in Stripe
    if (coupon.stripePromotionCodeId) {
      try {
        await this.stripe.promotionCodes.update(coupon.stripePromotionCodeId, {
          active: false,
        });
      } catch (error) {
        this.logger.warn(`Failed to deactivate Stripe promotion code: ${error}`);
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
      discountValue: doc.discountValue,
      validTo: doc.validTo,
      active: doc.active,
      stripeCouponId: doc.stripeCouponId ?? null,
      stripePromotionCodeId: doc.stripePromotionCodeId ?? null,
      description: doc.description ?? null,
      createdAt: doc.createdAt,
    };
  }
}
