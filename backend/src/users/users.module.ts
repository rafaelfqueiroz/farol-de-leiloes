import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service.js';
import { UserEntity, UserSchema } from './schemas/user.schema.js';
import { UsersPersonalData } from './users.personal-data.js';
import { PersonalDataRegistryModule } from '../privacy/registry/personal-data-registry.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserEntity.name, schema: UserSchema }]),
    PersonalDataRegistryModule, // SPEC-010: the account's data is registered for export and purge
  ],
  providers: [UsersService, UsersPersonalData],
  exports: [UsersService],
})
export class UsersModule {}
