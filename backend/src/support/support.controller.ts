import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async submitSupportRequest(
    @CurrentUser() user: any,
    @Body() dto: CreateSupportRequestDto,
  ) {
    return this.supportService.submitSupportRequest(
      user.userId,
      user.email,
      user.name,
      dto,
    );
  }
}
