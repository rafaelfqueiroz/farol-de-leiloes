// AR-08: the only file that touches the saved-filter model. Saved filters are the account's own data
// (SPEC-002 BR-002-02): every read and write is scoped to the request's account by
// AccountScopedRepository; no office ever reaches them (DL-002-08).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { AccountScopedRepository } from '../access/account-scoped.repository.js';
import type { AccessContext } from '../access/access-context.js';
import { skipOf, type PageRequest } from '../common/pagination/paginated.js';
import { SavedFilterEntity, type StoredFilterData } from './schemas/saved-filter.schema.js';

/** A saved filter as stored. */
export interface SavedFilterRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  filters: StoredFilterData;
  createdAt: Date;
}

@Injectable()
export class SavedFiltersRepository extends AccountScopedRepository<SavedFilterRecord> {
  constructor(@InjectModel(SavedFilterEntity.name) model: Model<SavedFilterEntity>) {
    super(model as unknown as Model<SavedFilterRecord>, 'SAVED_FILTER_NOT_FOUND');
  }

  /** AR-35: one page of the account's saved filters, newest first (`_id` breaks ties). */
  findPage(ctx: AccessContext, page: PageRequest): Promise<SavedFilterRecord[]> {
    return this.find(
      ctx,
      {},
      { sort: { createdAt: -1, _id: -1 }, skip: skipOf(page), limit: page.pageSize },
    );
  }

  /** The account's filter with this name. SC-10: the name is the user's text, compared by value. */
  findByName(ctx: AccessContext, name: string): Promise<SavedFilterRecord | null> {
    return this.findOne(ctx, { name: { $eq: name } });
  }
}
