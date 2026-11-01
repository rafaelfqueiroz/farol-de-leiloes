import { Controller, Post, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponResponseDto, CouponValidationResponseDto } from './dto/coupon-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('coupons')
export class CouponsController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async create(@Body() dto: CreateCouponDto): Promise<CouponResponseDto> {
    const coupon = await this.couponsService.create(dto);
    return new CouponResponseDto(coupon);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async findAll(): Promise<CouponResponseDto[]> {
    const coupons = await this.couponsService.findAll();
    return coupons.map((coupon) => new CouponResponseDto(coupon));
  }

  @Patch(':id/invalidate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async invalidate(@Param('id') id: string): Promise<CouponResponseDto> {
    const coupon = await this.couponsService.invalidate(id);
    return new CouponResponseDto(coupon);
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validate(@Body() dto: ValidateCouponDto): Promise<CouponValidationResponseDto> {
    const coupon = await this.couponsService.validateCoupon(dto.code);
    return new CouponValidationResponseDto(coupon);
  }
}
