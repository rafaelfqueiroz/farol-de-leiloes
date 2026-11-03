// AR-36: an auction leaves the API through these classes only, each field copied explicitly, so
// a field added to the stored document (storage keys, availability bookkeeping) never leaks.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Auction } from '../interfaces/auction.interface';
import {
  Address,
  ExpenseRule,
  Phase,
  PaymentMethod,
  PhaseModality,
} from '../schemas/auction.schema';

export class AuctionAddressDto {
  @ApiPropertyOptional({ type: String })
  street?: string;

  @ApiPropertyOptional({ type: String })
  neighborhood?: string;

  @ApiPropertyOptional({ type: String })
  city?: string;

  @ApiPropertyOptional({ type: String, description: 'UF, e.g. SP' })
  state?: string;

  @ApiPropertyOptional({ type: String })
  zipcode?: string;

  constructor(address: Address) {
    this.street = address.street;
    this.neighborhood = address.neighborhood;
    this.city = address.city;
    this.state = address.state;
    this.zipcode = address.zipcode;
  }
}

export class ExpenseRuleDto {
  @ApiProperty({ type: String, description: 'e.g. Condomínio, Tributos' })
  type: string;

  @ApiProperty({ type: String })
  description: string;

  constructor(rule: ExpenseRule) {
    this.type = rule.type;
    this.description = rule.description;
  }
}

export class AuctionPhaseDto {
  @ApiProperty({ enum: PhaseModality, enumName: 'PhaseModality' })
  modality: PhaseModality;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Minimum price in BRL' })
  minimumPrice?: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', isArray: true })
  phaseDates?: Date[];

  @ApiPropertyOptional({ enum: PaymentMethod, enumName: 'PaymentMethod', isArray: true })
  paymentMethods?: PaymentMethod[];

  @ApiPropertyOptional({ type: () => ExpenseRuleDto, isArray: true })
  expenseRules?: ExpenseRuleDto[];

  constructor(phase: Phase) {
    this.modality = phase.modality;
    this.minimumPrice = phase.minimumPrice;
    this.phaseDates = phase.phaseDates;
    this.paymentMethods = phase.paymentMethods;
    this.expenseRules = phase.expenseRules?.map((rule) => new ExpenseRuleDto(rule));
  }
}

export class AuctionResponseDto {
  @ApiProperty({ type: String, description: 'Caixa property number' })
  code: string;

  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: () => AuctionAddressDto, nullable: true })
  address: AuctionAddressDto | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Appraisal in BRL' })
  appraisalPrice: number | null;

  @ApiProperty({ type: () => AuctionPhaseDto, isArray: true })
  phases: AuctionPhaseDto[];

  @ApiProperty({ type: () => AuctionPhaseDto, nullable: true })
  currentPhase: AuctionPhaseDto | null;

  @ApiProperty({ type: String, nullable: true })
  detailsUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  matriculaUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  editalUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: Boolean, description: 'Details page already scraped' })
  fulfilled: boolean;

  @ApiProperty({ type: Boolean })
  available: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  constructor(auction: Auction) {
    this.code = auction.code;
    this.title = auction.title;
    this.address = auction.address ? new AuctionAddressDto(auction.address) : null;
    this.appraisalPrice = auction.appraisalPrice;
    this.phases = auction.phases.map((phase) => new AuctionPhaseDto(phase));
    this.currentPhase = auction.currentPhase ? new AuctionPhaseDto(auction.currentPhase) : null;
    this.detailsUrl = auction.detailsUrl;
    this.imageUrl = auction.imageUrl;
    this.matriculaUrl = auction.matriculaUrl;
    this.editalUrl = auction.editalUrl;
    this.description = auction.description;
    this.fulfilled = auction.fulfilled;
    this.available = auction.available;
    this.updatedAt = auction.updatedAt;
  }
}
