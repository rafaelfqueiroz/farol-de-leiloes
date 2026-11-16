// AR-08: the only file that touches the maintenance window model.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../common/mongo/query-safety.js';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated.js';
import type { UpcomingBounds } from './domain/maintenance-window.js';
import type { MaintenanceRecord, NewMaintenanceRecord } from './maintenance-record.js';
import { MaintenanceStore } from './maintenance.store.js';
import {
  MaintenanceWindowEntity,
  type MaintenanceWindowDocument,
} from './schemas/maintenance-window.schema.js';

@Injectable()
export class MaintenanceRepository extends MaintenanceStore {
  constructor(
    @InjectModel(MaintenanceWindowEntity.name)
    private readonly model: Model<MaintenanceWindowDocument>,
  ) {
    super();
  }

  async insert(record: NewMaintenanceRecord): Promise<MaintenanceRecord> {
    const created = await this.model.create({
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      message: record.message,
      announcedAt: record.announcedAt,
      createdBy: new Types.ObjectId(record.createdBy),
    });
    return toRecord(created);
  }

  async findPage(page: PageRequest): Promise<Paginated<MaintenanceRecord>> {
    const [total, docs] = await Promise.all([
      this.model.countDocuments().exec(),
      this.model
        .find()
        .sort({ startsAt: -1, _id: -1 })
        .skip(skipOf(page))
        .limit(page.pageSize)
        .exec(),
    ]);
    return paginated(docs.map(toRecord), total, page);
  }

  async findUpcoming(bounds: UpcomingBounds, limit: number): Promise<MaintenanceRecord[]> {
    // Lean read on the startsAt index: the public banner polls this.
    const docs = await this.model
      .find({
        endsAt: serverOperators({ $gt: bounds.endsAfter }),
        startsAt: serverOperators({ $lte: bounds.startsBy }),
      })
      .sort({ startsAt: 1, _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return docs.map((doc) => toRecord(doc as unknown as MaintenanceWindowDocument));
  }

  async deleteNotStarted(id: string, startsAfter: Date): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.model
      .deleteOne({ _id: new Types.ObjectId(id), startsAt: serverOperators({ $gt: startsAfter }) })
      .exec();
    return result.deletedCount === 1;
  }

  async exists(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    return (await this.model.exists({ _id: new Types.ObjectId(id) }).exec()) !== null;
  }
}

function toRecord(doc: MaintenanceWindowDocument): MaintenanceRecord {
  return {
    id: String(doc._id),
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    message: doc.message,
    announcedAt: doc.announcedAt,
    createdBy: String(doc.createdBy),
    createdAt: doc.createdAt,
  };
}
