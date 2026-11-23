import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupportRequestEntity, SupportRequestSchema } from './schemas/support-request.schema.js';
import { SupportRequestsRepository } from './support-requests.repository.js';
import { SupportRequestsSource } from './support-requests.source.js';

/**
 * SPEC-009: the support requests' store, and nothing else: the Mongoose model, its repository and the
 * real SUPPORT_REQUEST_SOURCE built on it. It imports no other module on purpose, so AccessModule can
 * import it to bind the source (access/access.module.ts: the one place the access sources are bound)
 * without importing auth or the admin code, which would be a cycle, and so `npm run grant-admin`,
 * which builds AccessModule alone, still reads the same source as the API. `SupportModule` imports it
 * too, for the routes and the outbox.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: SupportRequestEntity.name, schema: SupportRequestSchema }]),
  ],
  providers: [SupportRequestsRepository, SupportRequestsSource],
  exports: [SupportRequestsRepository, SupportRequestsSource],
})
export class SupportRequestsStoreModule {}
