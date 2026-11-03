// AR-35 exemption (ARCHITECTURE §8): neighborhoods and sitemap codes are lookups, not browsable
// lists. Each answers one complete set (a filter's options, the sitemap) that the caller needs
// whole, so they are not paginated; they still leave through explicit DTOs (AR-36).
import { ApiProperty } from '@nestjs/swagger';

export class NeighborhoodsResponseDto {
  @ApiProperty({ type: String, isArray: true, description: 'Distinct, sorted' })
  neighborhoods: string[];

  constructor(neighborhoods: string[]) {
    this.neighborhoods = neighborhoods;
  }
}

export class SitemapCodeDto {
  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  constructor(entry: { code: string; updatedAt: Date }) {
    this.code = entry.code;
    this.updatedAt = entry.updatedAt;
  }
}

export class SitemapCodesResponseDto {
  @ApiProperty({ type: () => SitemapCodeDto, isArray: true })
  codes: SitemapCodeDto[];

  constructor(codes: { code: string; updatedAt: Date }[]) {
    this.codes = codes.map((entry) => new SitemapCodeDto(entry));
  }
}
