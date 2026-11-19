// AR-08: the only file that touches the plan model. The catalog is public platform configuration,
// so nothing here is owner-scoped (AR-16 'public' mark on the schema).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { isObjectIdString } from '../access/owner-filter.js';
import { fromDecimal128, toDecimal128 } from '../common/money/decimal128.js';
import type { Plan, PlanDefinition } from './plan.js';
import { PlanEntity, type PlanDocument } from './schemas/plan.schema.js';

interface PlanRow {
  _id: Types.ObjectId;
  code: string;
  name: string;
  audience: Plan['audience'];
  price: Types.Decimal128;
  interval: Plan['interval'];
  activeJourneyLimit: number;
  stripePriceId: string;
  status: Plan['status'];
  sortOrder: number;
}

function toPlan(row: PlanRow): Plan {
  return Object.freeze({
    id: row._id.toHexString(),
    code: row.code,
    name: row.name,
    audience: row.audience,
    // AR-17: Decimal128 → Decimal, digit for digit.
    price: fromDecimal128(row.price),
    interval: row.interval,
    activeJourneyLimit: row.activeJourneyLimit,
    stripePriceId: row.stripePriceId,
    status: row.status,
    sortOrder: row.sortOrder,
  });
}

@Injectable()
export class PlansRepository {
  constructor(@InjectModel(PlanEntity.name) private readonly plans: Model<PlanDocument>) {}

  /** BR-012-05: the offered plans in the operator's order (code breaks ties, so it is stable). */
  async findOffered(): Promise<Plan[]> {
    const rows = await this.plans
      .find({ status: { $eq: 'OFFERED' } })
      .sort({ sortOrder: 1, code: 1 })
      .lean<PlanRow[]>()
      .exec();
    return rows.map(toPlan);
  }

  async findByCode(code: string): Promise<Plan | null> {
    if (typeof code !== 'string') return null;
    const row = await this.plans
      .findOne({ code: { $eq: code } })
      .lean<PlanRow>()
      .exec();
    return row ? toPlan(row) : null;
  }

  async findById(id: string): Promise<Plan | null> {
    if (!isObjectIdString(id)) return null;
    const row = await this.plans
      .findOne({ _id: { $eq: id } })
      .lean<PlanRow>()
      .exec();
    return row ? toPlan(row) : null;
  }

  /** BR-012-04: withdrawn plans included, so a subscription on one still resolves its plan. */
  async findByStripePriceId(stripePriceId: string): Promise<Plan | null> {
    if (typeof stripePriceId !== 'string') return null;
    const row = await this.plans
      .findOne({ stripePriceId: { $eq: stripePriceId } })
      .lean<PlanRow>()
      .exec();
    return row ? toPlan(row) : null;
  }

  /**
   * BR-012-02: writes the plan with this code, creating it when it is new. Idempotent: the same
   * definition twice leaves the same document. The audience is fixed (BR-012-06).
   */
  async upsertByCode(plan: PlanDefinition): Promise<'created' | 'updated'> {
    const { code, ...fields } = plan;
    const result = await this.plans
      .updateOne(
        { code: { $eq: code } },
        {
          $set: {
            ...fields,
            // AR-17: a Decimal128 on its way in; the schema never sees a number.
            price: toDecimal128(plan.price),
            audience: 'ADVISOR_OFFICE',
          },
          $setOnInsert: { code },
        },
        { upsert: true },
      )
      .exec();
    return result.upsertedCount === 1 ? 'created' : 'updated';
  }
}
