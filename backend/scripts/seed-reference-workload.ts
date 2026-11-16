// SPEC-003 BR-003-08: `node dist-e2e/scripts/seed-reference-workload.js`, run by the `seed`
// service of the E2E Compose stack (frontend/e2e/compose.e2e.yml); never against the developer's
// database or production (DV-19, reference-workload/target.ts). Configured by its own variables,
// never MONGODB_URI, so it cannot pick up the application's database by accident:
//
//   SEED_MONGODB_URI      required; mongodb://mongo-e2e:27017/<db> in the stack
//   SEED_AUCTIONS         generated auctions besides the fixtures; `full` = FULL_CATALOG_SIZE.
//                         Defaults to full.
//   SEED_RANDOM_SEED      PRNG seed; defaults to 3 (#3). Same seed + reference date = same data.
//   SEED_REFERENCE_DATE   ISO instant the phase dates are spread around; defaults to now, so the
//                         catalog reads as current to the search.
//   SEED_ALLOW_HOSTS      comma-separated extra hosts known to be throwaway databases.
import { Logger } from '@nestjs/common';
import { FULL_CATALOG_SIZE } from './reference-workload/catalog.js';
import { seedReferenceWorkload } from './reference-workload/seed.js';
import { SeedConfigError } from './reference-workload/target.js';
import { jobErrorCode } from '../src/common/services/job-error-code.js';

const logger = new Logger('ReferenceWorkloadSeed');

function auctionsFrom(value: string | undefined): number {
  if (value === undefined || value === '' || value === 'full') return FULL_CATALOG_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new SeedConfigError('SEED_AUCTIONS must be a non-negative integer or "full"');
  }
  return parsed;
}

function referenceDateFrom(value: string | undefined): Date {
  // A script, not the app: "now" is read here once and passed down (AR-24 keeps src/ on Clock).
  if (!value) return new Date(Date.now());
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new SeedConfigError('SEED_REFERENCE_DATE must be an ISO instant');
  return parsed;
}

async function main(): Promise<void> {
  const uri = process.env.SEED_MONGODB_URI;
  if (!uri) throw new SeedConfigError('SEED_MONGODB_URI is not set');
  const started = Date.now();
  await seedReferenceWorkload({
    uri,
    auctions: auctionsFrom(process.env.SEED_AUCTIONS),
    seed: Number(process.env.SEED_RANDOM_SEED ?? 3),
    referenceDate: referenceDateFrom(process.env.SEED_REFERENCE_DATE),
    allowHosts: (process.env.SEED_ALLOW_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  });
  logger.log(`Done in ${Math.round((Date.now() - started) / 1000)} s`);
}

// SC-15: a refusal or bad setting names itself; any other failure logs only its stable code, as
// main.ts does, because a driver error may quote the connection string.
main().catch((error: unknown) => {
  logger.error(
    error instanceof SeedConfigError ? error.message : `Seed failed: ${jobErrorCode(error)}`,
  );
  process.exit(1);
});
