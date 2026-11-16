import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service.js';
import { UserEntity, UserSchema } from './schemas/user.schema.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
