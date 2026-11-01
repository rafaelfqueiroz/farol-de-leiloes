import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { ReminderResponseDto } from './dto/reminder-response.dto';

@Controller('reminders')
@UseGuards(JwtAuthGuard)
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  async findAll(@CurrentUser() user: any): Promise<ReminderResponseDto[]> {
    const reminders = await this.remindersService.findAllByUser(user.userId);
    return reminders.map((r) => new ReminderResponseDto(r));
  }

  @Get(':id')
  async findOne(@CurrentUser() user: any, @Param('id') id: string): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.findOne(user.userId, id);
    return new ReminderResponseDto(reminder);
  }

  @Post()
  async create(
    @CurrentUser() user: any,
    @Body() dto: CreateReminderDto,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.create(user.userId, dto);
    return new ReminderResponseDto(reminder);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.update(user.userId, id, dto);
    return new ReminderResponseDto(reminder);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: any, @Param('id') id: string): Promise<void> {
    await this.remindersService.delete(user.userId, id);
  }
}
