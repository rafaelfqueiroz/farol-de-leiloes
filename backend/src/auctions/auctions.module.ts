import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { Auction, AuctionSchema } from './schemas/auction.schema';
import { AuctionsImporter } from './importer/scheduler';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Auction.name, schema: AuctionSchema },
    ]),
    CommonModule,
  ],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionsImporter],
  exports: [AuctionsService],
})
export class AuctionsModule {}

