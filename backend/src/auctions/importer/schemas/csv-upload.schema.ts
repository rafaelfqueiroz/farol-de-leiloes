import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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
