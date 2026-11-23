import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

/**
 * SPEC-009 BR-009-06: a platform counter. One document per counted thing, `_id` its key
 * (`support_protocol:2026`), `seq` the last number handed out. Advanced by one atomic `$inc`
 * (`SupportCountersRepository.next`), so two requests never get the same number. A number that was
 * handed out and then not used (the insert of the request failed) is a gap in the sequence: harmless,
 * a protocol only has to be unique. It holds no personal data.
 */
@Schema({ collection: 'counters', timestamps: true })
export class SupportCounterEntity {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq!: number;
}

export type SupportCounterDocument = HydratedDocument<SupportCounterEntity>;

export const SupportCounterSchema = SchemaFactory.createForClass(SupportCounterEntity);

markIsolation(SupportCounterSchema, {
  kind: 'internal',
  reason:
    'Platform counters (the support protocol sequence, SPEC-009 BR-009-06): keys and numbers, no account data, advanced by the server only',
});
