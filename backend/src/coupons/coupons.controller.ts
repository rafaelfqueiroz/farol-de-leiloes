import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponResponseDto, CouponValidationResponseDto } from './dto/coupon-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { mapPage, type Paginated } from '../common/pagination/paginated';

const ADMIN_ONLY = {
  description: 'FORBIDDEN or PLAN_NOT_ALLOWED: admins only',
  type: ErrorResponseDto,
};

@ApiTags('coupons')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('coupons')
export class CouponsController {
  constructor(private couponsService: CouponsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Create a coupon and its Stripe promotion code (admin)' })
  @ApiCreatedResponse({ type: CouponResponseDto })
  @ApiForbiddenResponse(ADMIN_ONLY)
  async create(@Body() dto: CreateCouponDto): Promise<CouponResponseDto> {
    const coupon = await this.couponsService.create(dto);
    return new CouponResponseDto(coupon);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Every coupon, newest first (admin, paginated, AR-35)' })
  @ApiPaginatedResponse(CouponResponseDto)
  @ApiForbiddenResponse(ADMIN_ONLY)
  async findAll(@Query() query: PaginationQueryDto): Promise<Paginated<CouponResponseDto>> {
    const page = await this.couponsService.findPage(query);
    return mapPage(page, (coupon) => new CouponResponseDto(coupon));
  }

  @Patch(':id/invalidate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate a coupon and its Stripe promotion code (admin)' })
  @ApiOkResponse({ type: CouponResponseDto })
  @ApiForbiddenResponse(ADMIN_ONLY)
  @ApiNotFoundResponse({ description: 'COUPON_NOT_FOUND', type: ErrorResponseDto })
  async invalidate(@Param('id') id: string): Promise<CouponResponseDto> {
    const coupon = await this.couponsService.invalidate(id);
    return new CouponResponseDto(coupon);
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Check that a coupon code can be used at checkout' })
  @ApiCreatedResponse({ type: CouponValidationResponseDto })
  async validate(@Body() dto: ValidateCouponDto): Promise<CouponValidationResponseDto> {
    const coupon = await this.couponsService.validateCoupon(dto.code);
    return new CouponValidationResponseDto(coupon);
  }
}
