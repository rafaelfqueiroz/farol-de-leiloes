import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CsvUpload, CsvUploadDocument } from './schemas/csv-upload.schema';
import { StorageService } from '../../storage/storage.service';
import { downloadCsvAllStates } from './downloader';
import { errorMessage } from '../../common/error-message';

@Injectable()
export class CsvCacheService {
  private readonly logger = new Logger(CsvCacheService.name);
  private readonly R2_KEY = 'importer/Lista_imoveis_geral.csv';

  constructor(
    @InjectModel(CsvUpload.name)
    private readonly csvUploadModel: Model<CsvUploadDocument>,
    private readonly storage: StorageService,
  ) {}

  async resolveCsv(): Promise<string> {
    if (!this.storage.isConfigured()) {
      this.logger.warn('R2 not configured, downloading directly from Caixa');
      return downloadCsvAllStates();
    }

    const record = await this.csvUploadModel.findOne({}).lean();

    if (record && this.isTodaysUpload(record.lastUpload)) {
      this.logger.log('CSV already uploaded today, fetching from R2');
      try {
        return await this.fetchFromR2();
      } catch (error) {
        this.logger.warn(`R2 fetch failed, falling back to Caixa: ${errorMessage(error)}`);
      }
    }

    return this.fetchFromCaixaAndUpload();
  }

  private isTodaysUpload(lastUpload: Date): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const uploadDate = lastUpload.toISOString().slice(0, 10);
    return today === uploadDate;
  }

  private async fetchFromR2(): Promise<string> {
    const buffer = await this.storage.downloadBuffer(this.R2_KEY);
    return buffer.toString('utf8');
  }

  private async fetchFromCaixaAndUpload(): Promise<string> {
    this.logger.log('Downloading CSV from Caixa');
    const csv = await downloadCsvAllStates();

    const buffer = Buffer.from(csv, 'utf8');

    this.logger.log('Uploading CSV to R2');
    await this.storage.uploadBuffer(this.R2_KEY, buffer, 'text/csv; charset=utf-8');

    await this.saveUploadRecord(this.R2_KEY, buffer.length);
    this.logger.log(`CSV cached in R2 (${buffer.length} bytes)`);

    return csv;
  }

  private async saveUploadRecord(fileName: string, fileSize: number): Promise<void> {
    try {
      await this.csvUploadModel.findOneAndUpdate(
        {},
        { lastUpload: new Date(), fileName, fileSize },
        { upsert: true, new: true },
      );
    } catch (error) {
      this.logger.error(`Failed to save CSV upload record: ${errorMessage(error)}`);
    }
  }
}
