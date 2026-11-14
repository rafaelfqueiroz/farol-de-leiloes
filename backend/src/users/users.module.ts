import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service.js';
import { UserEntity, UserSchema } from './schemas/user.schema.js';
import { CommonModule } from '../common/common.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
    CommonModule, // AR-24: the Clock
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
