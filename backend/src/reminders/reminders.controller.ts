import {
  Controller,
  UseGuards,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RemindersService } from './reminders.service.js';
import type { AccessContext } from '../access/access-context.js';
import { Access } from '../access/decorators/access.decorator.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { ReminderResponseDto } from './dto/reminder-response.dto.js';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator.js';
import { ApiConfirmedEmail } from '../auth/decorators/api-confirmed-email.decorator.js';
import { ConfirmedEmailGuard } from '../auth/guards/confirmed-email.guard.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator.js';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto.js';
import { mapPage, type Paginated } from '../common/pagination/paginated.js';

const NOT_FOUND = { description: 'REMINDER_NOT_FOUND', type: ErrorResponseDto };

@ApiTags('reminders')
@ApiErrorResponses()
@ApiJwtAuth()
@ApiConfirmedEmail()
@UseGuards(ConfirmedEmailGuard) // BR-001-04: server-side, not only the frontend banner
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user reminders, soonest first (paginated, AR-35)' })
  @ApiPaginatedResponse(ReminderResponseDto)
  async findAll(
    @Access() access: AccessContext,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ReminderResponseDto>> {
    const page = await this.remindersService.findPageByUser(access, query);
    return mapPage(page, (reminder) => new ReminderResponseDto(reminder));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of the signed-in user reminders' })
  @ApiOkResponse({ type: ReminderResponseDto })
  @ApiNotFoundResponse(NOT_FOUND)
  async findOne(
    @Access() access: AccessContext,
    @Param('id') id: string,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.findOne(access, id);
    return new ReminderResponseDto(reminder);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a reminder for an auction' })
  @ApiCreatedResponse({ type: ReminderResponseDto })
  async create(
    @Access() access: AccessContext,
    @Body() dto: CreateReminderDto,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.create(access, dto);
    return new ReminderResponseDto(reminder);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a pending reminder' })
  @ApiOkResponse({ type: ReminderResponseDto })
  @ApiNotFoundResponse(NOT_FOUND)
  async update(
    @Access() access: AccessContext,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.update(access, id, dto);
    return new ReminderResponseDto(reminder);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a reminder' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse(NOT_FOUND)
  async delete(@Access() access: AccessContext, @Param('id') id: string): Promise<void> {
    await this.remindersService.delete(access, id);
  }
}
