import {
  Controller,
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
import { RemindersService } from './reminders.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/auth.interface';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { ReminderResponseDto } from './dto/reminder-response.dto';
import { ApiJwtAuth } from '../auth/decorators/api-jwt-auth.decorator';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';
import { ErrorResponseDto } from '../common/errors/error-response.dto';
import { ApiPaginatedResponse } from '../common/pagination/api-paginated-response.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { mapPage, type Paginated } from '../common/pagination/paginated';

const NOT_FOUND = { description: 'REMINDER_NOT_FOUND', type: ErrorResponseDto };

@ApiTags('reminders')
@ApiErrorResponses()
@ApiJwtAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Get()
  @ApiOperation({ summary: 'The signed-in user reminders, soonest first (paginated, AR-35)' })
  @ApiPaginatedResponse(ReminderResponseDto)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ReminderResponseDto>> {
    const page = await this.remindersService.findPageByUser(user.userId, query);
    return mapPage(page, (reminder) => new ReminderResponseDto(reminder));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of the signed-in user reminders' })
  @ApiOkResponse({ type: ReminderResponseDto })
  @ApiNotFoundResponse(NOT_FOUND)
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.findOne(user.userId, id);
    return new ReminderResponseDto(reminder);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a reminder for an auction' })
  @ApiCreatedResponse({ type: ReminderResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReminderDto,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.create(user.userId, dto);
    return new ReminderResponseDto(reminder);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a pending reminder' })
  @ApiOkResponse({ type: ReminderResponseDto })
  @ApiNotFoundResponse(NOT_FOUND)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderResponseDto> {
    const reminder = await this.remindersService.update(user.userId, id, dto);
    return new ReminderResponseDto(reminder);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a reminder' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse(NOT_FOUND)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.remindersService.delete(user.userId, id);
  }
}
