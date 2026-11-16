import { Controller, Post, Get, Patch, Body, Param, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CouponsService } from './coupons.service.js';
import { CreateCouponDto } from './dto/create-coupon.dto.js';
import { ValidateCouponDto } from './dto/validate-coupon.dto.js';
import { CouponResponseDto, CouponValidationResponseDto } from './dto/coupon-response.dto.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { AdminOnly } from '../access/decorators/access-guards.decorator.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';

@ApiTags('coupons')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('coupons')
export class CouponsController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  @AdminOnly() // SPEC-002 BR-002-23: users.isAdmin, never the plan tier
  @ApiOperation({ summary: 'Create a coupon and its Stripe promotion code (admin)' })
  @ApiCreatedResponse({ type: CouponResponseDto })
  async create(@Body() dto: CreateCouponDto): Promise<CouponResponseDto> {
    const coupon = await this.couponsService.create(dto);
    return new CouponResponseDto(coupon);
  }

  @Get()
  @AdminOnly() // SPEC-002 BR-002-23: users.isAdmin, never the plan tier
  @ApiOperation({ summary: 'Every coupon, newest first (admin, paginated, AR-35)' })
  @ApiPaginatedResponse(CouponResponseDto)
  async findAll(@Query() query: PaginationQueryDto): Promise<Paginated<CouponResponseDto>> {
    const page = await this.couponsService.findPage(query);
    return mapPage(page, (coupon) => new CouponResponseDto(coupon));
  }

  @Patch(':id/invalidate')
  @AdminOnly() // SPEC-002 BR-002-23: users.isAdmin, never the plan tier
  @ApiOperation({ summary: 'Deactivate a coupon and its Stripe promotion code (admin)' })
  @ApiOkResponse({ type: CouponResponseDto })
  @ApiNotFoundResponse({ description: 'COUPON_NOT_FOUND', type: ErrorResponseDto })
  async invalidate(@Param('id') id: string): Promise<CouponResponseDto> {
    const coupon = await this.couponsService.invalidate(id);
    return new CouponResponseDto(coupon);
  }

  @Post('validate')
  @ApiOperation({ summary: 'Check that a coupon code can be used at checkout' })
  @ApiCreatedResponse({ type: CouponValidationResponseDto })
  async validate(@Body() dto: ValidateCouponDto): Promise<CouponValidationResponseDto> {
    const coupon = await this.couponsService.validateCoupon(dto.code);
    return new CouponValidationResponseDto(coupon);
  }
}
