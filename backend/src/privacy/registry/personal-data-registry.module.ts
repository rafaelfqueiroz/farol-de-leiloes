import { Module } from '@nestjs/common';
import { PersonalDataRegistry } from './personal-data-registry.js';

/**
 * SPEC-010 AR-09: the registry of personal-data providers, in a module of its own that imports
 * nothing, so any module (users, auth, favorites, reminders, privacy, SPEC-011's offices) can import
 * it to register a provider without a cycle and without reaching into the privacy rights part.
 */
@Module({
  providers: [PersonalDataRegistry],
  exports: [PersonalDataRegistry],
})
export class PersonalDataRegistryModule {}
