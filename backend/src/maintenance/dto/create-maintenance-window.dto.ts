import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/** A date and a time: a bare date is no maintenance window. */
const WITH_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// `announcedAt` is deliberately not a field: the server sets it from its Clock (BR-003-03), and
// the global ValidationPipe (forbidNonWhitelisted) refuses a body that sends it. "In the future"
// and "ends after it starts" are rules about now, so MaintenanceService checks them (AR-24).
export class CreateMaintenanceWindowDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-03-10T02:00:00-03:00',
    description:
      'Start, in the future. A date-time without an offset is read as Brasília time (AR-23)',
  })
  @IsDateString()
  @Matches(WITH_TIME)
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-03-10T04:00:00-03:00',
    description: 'Expected end, after the start. Running past it counts as downtime',
  })
  @IsDateString()
  @Matches(WITH_TIME)
  endsAt!: string;

  @ApiProperty({
    type: String,
    maxLength: 500,
    example: 'Manutenção programada: o Farol dos Leilões ficará indisponível por cerca de 2 horas.',
    description: 'The announcement shown to every visitor, in pt-BR. No personal data',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  message!: string;
}
