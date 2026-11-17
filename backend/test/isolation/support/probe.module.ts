// SPEC-002 TS-13..TS-17: a PROBE owned collection, used only by the isolation suite. No owned
// collection exists yet (journeys, clients and profiles come with SPEC-011/016), so the framework
// is proven on this one: an owned schema (ownerType/ownerId, AR-11), a repository extending
// OwnerScopedRepository (AR-12), and a controller wired like a real one — @Access(), the PR 1
// guards and an OwnerCounterRepository plan limit (BR-002-13) — exercised through HTTP.
//
// It lives under test/ and is never part of the API: the production models are what the gate
// (model-coverage.isolation.spec.ts) enumerates.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { type Model, Schema as MongooseSchema, Types } from 'mongoose';
import type { AccessContext } from '../../../src/access/access-context.js';
import { Access } from '../../../src/access/decorators/access.decorator.js';
import {
  AdminOnly,
  RequiresEntitlement,
  RequiresPersona,
} from '../../../src/access/decorators/access-guards.decorator.js';
import { OwnerCounterRepository } from '../../../src/access/owner-counter.repository.js';
import { OwnerCountersModule } from '../../../src/access/owner-counters.module.js';
import {
  type OwnedRecordChanges,
  OwnerScopedRepository,
} from '../../../src/access/owner-scoped.repository.js';
import { DomainError } from '../../../src/common/errors/domain-error.js';

export const PROBE_ENTITLEMENT = 'probes';
/** BR-002-13: at most this many probes per owner at once (counted by OwnerCounterRepository). */
export const PROBE_LIMIT = 10;
const PROBE_COUNTER = 'probes';
const STATUSES = ['open', 'closed'] as const;
type ProbeStatus = (typeof STATUSES)[number];

@Schema({ collection: 'probes', timestamps: true })
export class ProbeEntity {
  @Prop({ required: true, type: String, enum: ['office', 'self_advised'] })
  ownerType!: 'office' | 'self_advised';

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  ownerId!: Types.ObjectId;

  @Prop({ required: true, type: String })
  name!: string;

  @Prop({ required: true, type: String, enum: STATUSES, default: 'open' })
  status!: ProbeStatus;

  /** The account the record is conducted for (a journey's investor, SPEC-016). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  investorUserId?: Types.ObjectId;

  @Prop({ type: Date })
  closedAt?: Date;
}

export const ProbeSchema = SchemaFactory.createForClass(ProbeEntity);
ProbeSchema.index({ ownerType: 1, ownerId: 1, createdAt: -1 }); // AR-11 / AR-27

/** A probe as stored. */
export interface ProbeRecord {
  _id: Types.ObjectId;
  ownerType: 'office' | 'self_advised';
  ownerId: Types.ObjectId;
  name: string;
  status: ProbeStatus;
  investorUserId?: Types.ObjectId;
  closedAt?: Date;
}

@Injectable()
export class ProbeRepository extends OwnerScopedRepository<ProbeRecord> {
  constructor(@InjectModel(ProbeEntity.name) model: Model<ProbeEntity>) {
    super(model as unknown as Model<ProbeRecord>);
  }

  /** BR-002-05 / BR-002-07: exposed, read-only, for the investor route. */
  listAsInvestor(ctx: AccessContext): Promise<ProbeRecord[]> {
    return this.findAsInvestor(ctx, {}, { sort: { name: 1 } });
  }
}

class ProbeListQuery {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProbeStatus;

  /** A member of several offices narrows the list to one of them (BR-002-11). */
  @IsOptional()
  @IsString()
  officeId?: string;
}

class CreateProbeDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  /** Which of the caller's offices acts (checked against its memberships, BR-002-11). */
  @IsOptional()
  @IsString()
  officeId?: string;

  @IsOptional()
  @IsMongoId()
  investorUserId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProbeStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closedAt?: Date;
}

class UpdateProbeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ProbeStatus;
}

/** AR-36: the answer, field by field. */
export interface ProbeAnswer {
  id: string;
  name: string;
  status: ProbeStatus;
  ownerType: string;
  ownerId: string;
}

function toAnswer(record: ProbeRecord): ProbeAnswer {
  return {
    id: record._id.toString(),
    name: record.name,
    status: record.status,
    ownerType: record.ownerType,
    ownerId: record.ownerId.toString(),
  };
}

function page(records: ProbeRecord[], total: number) {
  return { items: records.map(toAnswer), total };
}

@Controller('probes')
export class ProbeController {
  constructor(
    private readonly probes: ProbeRepository,
    private readonly counters: OwnerCounterRepository,
  ) {}

  @Get()
  @RequiresEntitlement(PROBE_ENTITLEMENT)
  async list(@Access() ctx: AccessContext, @Query() query: ProbeListQuery) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter['status'] = { $eq: query.status };
    if (query.officeId !== undefined) {
      // BR-002-11: an office the caller is not a member of is NOT_FOUND, like a missing one.
      const { owner } = ctx.resolveActingOwner(query.officeId);
      filter['ownerType'] = { $eq: owner.ownerType };
      filter['ownerId'] = { $eq: owner.ownerId };
    }
    const [records, total] = await Promise.all([
      this.probes.find(ctx, filter, { sort: { name: 1 } }),
      this.probes.count(ctx, filter),
    ]);
    return page(records, total);
  }

  /** BR-002-05 / BR-002-06: the investor's read-only view; there is no investor write route. */
  @Get('as-investor')
  @RequiresPersona('investor')
  async asInvestor(@Access() ctx: AccessContext) {
    const records = await this.probes.listAsInvestor(ctx);
    return page(records, records.length);
  }

  /** A path office id: one of the caller's offices, or NOT_FOUND (BR-002-11, BR-002-12). */
  @Get('offices/:officeId')
  @RequiresEntitlement(PROBE_ENTITLEMENT)
  async listOffice(@Access() ctx: AccessContext, @Param('officeId') officeId: string) {
    const { owner } = ctx.resolveActingOwner(officeId);
    const filter = { ownerType: { $eq: owner.ownerType }, ownerId: { $eq: owner.ownerId } };
    const [records, total] = await Promise.all([
      this.probes.find(ctx, filter, { sort: { name: 1 } }),
      this.probes.count(ctx, filter),
    ]);
    return page(records, total);
  }

  /** BR-002-23: an admin-only route still reads nothing an admin does not own (SC-09). */
  @Get('admin/:id')
  @AdminOnly()
  async adminRead(@Access() ctx: AccessContext, @Param('id') id: string) {
    return this.one(ctx, id);
  }

  // Record routes carry no entitlement guard: ownership in the repository is the control, so an
  // account with no relationship (an admin, a removed member) gets the not-found of a missing id.
  @Get(':id')
  async read(@Access() ctx: AccessContext, @Param('id') id: string) {
    return this.one(ctx, id);
  }

  @Post()
  @RequiresEntitlement(PROBE_ENTITLEMENT, { write: true })
  async create(@Access() ctx: AccessContext, @Body() dto: CreateProbeDto) {
    // BR-002-11: the owner is one the account conducts, chosen on the server.
    const actingOwner = ctx.resolveActingOwner(dto.officeId);
    // BR-002-13 / AR-15: the limit is counted with the write, atomically.
    if (!(await this.counters.tryAcquire(ctx, PROBE_COUNTER, PROBE_LIMIT, { actingOwner }))) {
      throw new DomainError('PLAN_NOT_ALLOWED', { limit: PROBE_LIMIT });
    }
    try {
      const created = await this.probes.create(
        ctx,
        {
          name: dto.name,
          status: dto.status ?? 'open',
          ...(dto.investorUserId ? { investorUserId: new Types.ObjectId(dto.investorUserId) } : {}),
          ...(dto.closedAt ? { closedAt: dto.closedAt } : {}),
        },
        { actingOwner },
      );
      return toAnswer(created);
    } catch (error) {
      await this.counters.release(ctx, actingOwner.owner, PROBE_COUNTER);
      throw error;
    }
  }

  @Patch(':id')
  async update(@Access() ctx: AccessContext, @Param('id') id: string, @Body() dto: UpdateProbeDto) {
    const changes: OwnedRecordChanges<ProbeRecord> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.status !== undefined) changes.status = dto.status;
    return toAnswer(await this.probes.updateById(ctx, id, changes));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Access() ctx: AccessContext, @Param('id') id: string): Promise<void> {
    const deleted = await this.probes.deleteById(ctx, id);
    await this.counters.release(
      ctx,
      { ownerType: deleted.ownerType, ownerId: deleted.ownerId.toString() },
      PROBE_COUNTER,
    );
  }

  private async one(ctx: AccessContext, id: string): Promise<ProbeAnswer> {
    const record = await this.probes.findById(ctx, id);
    if (!record) throw new DomainError('NOT_FOUND'); // BR-002-12: foreign and missing alike
    return toAnswer(record);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProbeEntity.name, schema: ProbeSchema }]),
    OwnerCountersModule,
  ],
  controllers: [ProbeController],
  providers: [ProbeRepository],
  exports: [ProbeRepository],
})
export class ProbeModule {}
