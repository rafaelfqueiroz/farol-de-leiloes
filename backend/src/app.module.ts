import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuctionsModule } from './auctions/auctions.module';
import { FavoritesModule } from './favorites/favorites.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import schedulerConfig from './config/scheduler.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [schedulerConfig]
    }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/auctions',
    ),
    ScheduleModule.forRoot(),
    UsersModule,
    AuthModule,
    AuctionsModule,
    FavoritesModule,
  ],
})
export class AppModule {}

