// AR-36: the catalog as the public plans page sees it, each field copied explicitly. The provider's
// price id and the audience are internal and stay out.
import { ApiProperty } from '@nestjs/swagger';
import { MONEY_API_PROPERTY, moneyToJson } from '../../common/money/money-dto.js';
import { PLAN_INTERVALS, type Plan } from '../plan.js';

export class PlanResponseDto {
  @ApiProperty({ type: String, description: 'Stable plan code, e.g. what checkout names' })
  code: string;

  @ApiProperty({ type: String })
  name: string;

  // AR-17: reais as a string, rounded at the edge (AR-19).
  @ApiProperty({ ...MONEY_API_PROPERTY, description: 'Price per billing interval, in reais' })
  price: string;

  @ApiProperty({ enum: PLAN_INTERVALS, enumName: 'PlanInterval' })
  interval: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    description: 'Journeys the office can have in progress at the same time (BR-012-01)',
  })
  activeJourneyLimit: number;

  constructor(plan: Plan) {
    this.code = plan.code;
    this.name = plan.name;
    this.price = moneyToJson(plan.price);
    this.interval = plan.interval;
    this.activeJourneyLimit = plan.activeJourneyLimit;
  }
}

/** AR-35 lookup exemption: the whole offered catalog at once, in an object envelope. */
export class PlansResponseDto {
  @ApiProperty({ type: () => [PlanResponseDto] })
  items: PlanResponseDto[];

  constructor(plans: readonly Plan[]) {
    this.items = plans.map((plan) => new PlanResponseDto(plan));
  }
}
