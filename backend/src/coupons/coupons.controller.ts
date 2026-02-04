import { Controller, Post, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('coupons')
export class CouponsController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async create(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async findAll() {
    return this.couponsService.findAll();
  }

  @Patch(':id/invalidate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async invalidate(@Param('id') id: string) {
    return this.couponsService.invalidate(id);
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  async validate(@Body() dto: ValidateCouponDto) {
    const coupon = await this.couponsService.validateCoupon(dto.code);
    return {
      code: coupon.code,
      discountValue: coupon.discountValue,
      validTo: coupon.validTo,
      description: coupon.description,
    };
  }
}
