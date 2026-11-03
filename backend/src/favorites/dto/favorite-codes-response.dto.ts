import { ApiProperty } from '@nestjs/swagger';

/**
 * Every auction code the signed-in user favorited, for the heart state on cards. A lookup the
 * client needs whole, so not paginated (ARCHITECTURE §8, AR-35 exemption); owner-scoped (AR-12).
 */
export class FavoriteCodesResponseDto {
  @ApiProperty({ type: String, isArray: true, description: 'Most recently favorited first' })
  codes: string[];

  constructor(codes: string[]) {
    this.codes = codes;
  }
}
