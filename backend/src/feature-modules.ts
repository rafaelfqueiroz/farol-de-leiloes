// The API's feature modules, in AppModule's order: everything that registers a controller, a
// service or a Mongoose model. AppModule adds the process-wide infrastructure (validated
// configuration, logging, the MongoDB connection, the scheduler) in front of them.
//
// A separate file so the SPEC-002 isolation gate (test/isolation/model-coverage.isolation.spec.ts)
// can compile exactly the API's models on a test database without importing app.module.ts, whose
// ConfigModule.forRoot reads the process environment and a .env file as it is imported (DV-19).
import { AuctionsModule } from './auctions/auctions.module.js';
import { FavoritesModule } from './favorites/favorites.module.js';
import { SavedFiltersModule } from './saved-filters/saved-filters.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { PrivacyRightsModule } from './privacy/rights/privacy-rights.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { CouponsModule } from './coupons/coupons.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { AiModule } from './ai/ai.module.js';
import { SupportModule } from './support/support.module.js';
import { HealthModule } from './health/health.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { AdminAccessModule } from './admin-access/admin-access.module.js';
import { PlansModule } from './plans/plans.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { SubscriptionsBillingModule } from './subscriptions/subscriptions-billing.module.js';

export const FEATURE_MODULES = [
  UsersModule,
  AuthModule,
  PrivacyModule,
  PrivacyRightsModule,
  AuctionsModule,
  FavoritesModule,
  SavedFiltersModule,
  PaymentsModule,
  CouponsModule,
  RemindersModule,
  AiModule,
  SupportModule,
  HealthModule,
  MaintenanceModule,
  AdminAccessModule,
  PlansModule,
  SubscriptionsModule,
  SubscriptionsBillingModule,
];
