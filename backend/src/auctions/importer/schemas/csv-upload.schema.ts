import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../../access/isolation-mark.js';

@Schema({ collection: 'csvuploads', timestamps: false })
export class CsvUpload {
  @Prop({ required: true, type: Date })
  lastUpload!: Date;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  fileSize!: number;
}

export type CsvUploadDocument = HydratedDocument<CsvUpload>;
export const CsvUploadSchema = SchemaFactory.createForClass(CsvUpload);

// AR-16 / TS-14: the isolation class of this collection.
markIsolation(CsvUploadSchema, {
  kind: 'public',
  reason: 'Import bookkeeping of the public Caixa lists (SPEC-004); no account or client data',
});
