import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

/**
 * SPEC-010 BR-010-28: the stable pseudonym one person keeps inside one journey ("usuário removido"
 * plus this label) once they are gone. `userId` links the label to the person while they exist and
 * is set to null by `detachUser` when the account is purged, which is what makes the label
 * untraceable (BR-010-15): the pseudonym is random, derived from nothing about the person.
 */
@Schema({ collection: 'actorPseudonyms', timestamps: true })
export class ActorPseudonymEntity {
  /** The journey the label is valid in (SPEC-016); the same person has another label elsewhere. */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  journeyId!: Types.ObjectId;

  /** The person while the account exists; null after `detachUser`. */
  @Prop({ required: false, type: MongooseSchema.Types.ObjectId, default: null })
  userId!: Types.ObjectId | null;

  /** At least 128 random bits as text (domain/pseudonym.ts): nothing about the person. */
  @Prop({ required: true, type: String })
  pseudonym!: string;
}

export type ActorPseudonymDocument = HydratedDocument<ActorPseudonymEntity>;

export const ActorPseudonymSchema = SchemaFactory.createForClass(ActorPseudonymEntity);

// AR-27 / AR-29: built in production by migration 0009-privacy-rights-indexes, whose unit spec holds
// them equal to these.
// One label per person and journey, whatever races. Partial on an existing account: any number of
// detached rows (userId null) may share a journey.
ActorPseudonymSchema.index(
  { journeyId: 1, userId: 1 },
  {
    unique: true,
    name: 'one_pseudonym_per_person_and_journey',
    partialFilterExpression: { userId: { $type: 'objectId' } },
  },
);
// Two people of a journey never share a label (128 random bits make a clash a fault, not a chance).
ActorPseudonymSchema.index(
  { journeyId: 1, pseudonym: 1 },
  { unique: true, name: 'one_person_per_pseudonym_in_journey' },
);
// `detachUser`: every row of one account.
ActorPseudonymSchema.index(
  { userId: 1 },
  { name: 'pseudonyms_of_user', partialFilterExpression: { userId: { $type: 'objectId' } } },
);

// AR-16: no owner path. The label is read through the journey's own services (SPEC-011/016), which
// scope by the journey's owner; the collection itself is never listed per owner or account.
markIsolation(ActorPseudonymSchema, {
  kind: 'internal',
  reason:
    'Stable pseudonyms of people inside journeys (SPEC-010 BR-010-28): resolved by (journey, person) through the pseudonym service, never listed per owner or account',
});
