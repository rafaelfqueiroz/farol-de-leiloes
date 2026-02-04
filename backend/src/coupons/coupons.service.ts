import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import Stripe from 'stripe';
import { Coupon, CouponDocument } from './schemas/coupon.schema';
import { CreateCouponDto } from './dto/create-coupon.dto';

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);
  private stripe: Stripe;

  constructor(
    @InjectModel(Coupon.name) private readonly couponModel: Model<CouponDocument>,
    private configService: ConfigService,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY')!);
  }

  async create(dto: CreateCouponDto): Promise<CouponDocument> {
    // Create Stripe coupon with absolute amount off
    const stripeCoupon = await this.stripe.coupons.create({
      amount_off: dto.discountValue,
      currency: 'brl',
      duration: 'once',
      name: dto.code,
    });

    // Create Stripe promotion code (user-facing code)
    const promoCode = await this.stripe.promotionCodes.create({
      coupon: stripeCoupon.id,
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

    return coupon.save();
  }

  async findAll(): Promise<CouponDocument[]> {
    return this.couponModel.find().sort({ createdAt: -1 }).exec();
  }

  async validateCoupon(code: string): Promise<CouponDocument> {
    const coupon = await this.couponModel.findOne({ code: code.toUpperCase() }).exec();

    if (!coupon || !coupon.active || new Date(coupon.validTo) < new Date()) {
      throw new BadRequestException('Este cupom encontra-se invalido');
    }

    return coupon;
  }

  async invalidate(id: string): Promise<CouponDocument> {
    const coupon = await this.couponModel.findById(id).exec();

    if (!coupon) {
      throw new NotFoundException('Cupom não encontrado');
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
    return coupon.save();
  }

  async findByCode(code: string): Promise<CouponDocument | null> {
    return this.couponModel.findOne({ code: code.toUpperCase() }).exec();
  }
}
