// AR-36: the envelope of "my data" and of the export file. The sections after it (one per registered
// provider: `account`, `favorites`, `savedFilters`, ...) are described by the providers' own
// documentation in the privacy guide; they are open by design, a new module adds its own.
import { ApiProperty } from '@nestjs/swagger';

export class MyDataResponseDto {
  @ApiProperty({ type: Number, example: 1, description: 'Bumped when the envelope changes shape' })
  schemaVersion!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: string;
}
