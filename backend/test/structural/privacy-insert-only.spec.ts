// SPEC-010 BR-010-03 / AR-30: the acceptance and WhatsApp consent records are proof, so nothing in the
// privacy module may edit or delete a row. The schemas refuse it at runtime (insert-only.ts); this
// is the first line, at review time: the two repositories expose insert and read methods only, and
// no file of privacy/ calls an update, replace, delete or bulk-write operation.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULE_DIR = join(import.meta.dirname, '..', '..', 'src', 'privacy');

// `rights/` (SPEC-010 part 2: exports, closure, purge, pseudonyms) holds records that ARE edited and
// deleted by design and has its own repositories; the insert-only rule is the consent records'.
const sources = (readdirSync(MODULE_DIR, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .filter((file) => !file.split('\\').join('/').startsWith('rights/'))
  .map((file) => ({ file, text: readFileSync(join(MODULE_DIR, file), 'utf8') }));

const MUTATING_CALL =
  /\.(updateOne|updateMany|findOneAndUpdate|findOneAndReplace|findOneAndDelete|replaceOne|deleteOne|deleteMany|bulkWrite|findByIdAndUpdate|findByIdAndDelete|findOneAndRemove|remove|drop|dropCollection|dropIndexes?)\s*\(/;

/** The method names declared by a repository class (everything but the constructor). */
function methodsOf(text: string): string[] {
  return [...text.matchAll(/^ {2}(?:async )?([a-zA-Z]+)\(/gm)]
    .map((match) => match[1] as string)
    .filter((name) => name !== 'constructor');
}

describe('SPEC-010 BR-010-03 / AR-30: acceptances and consents are insert-only', () => {
  it('finds the privacy module sources', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('no file of privacy/ calls an update, replace, delete, drop or bulk write', () => {
    const offenders = sources
      .filter(({ file, text }) => file !== 'schemas/insert-only.ts' && MUTATING_CALL.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('ConsentsRepository exposes inserts and reads only', () => {
    const text = sources.find(({ file }) => file === 'consents.repository.ts')?.text ?? '';
    expect(methodsOf(text)).toEqual(['insert', 'findAccepted', 'listForUser']);
  });

  it('WhatsappConsentRepository exposes inserts and reads only', () => {
    const text = sources.find(({ file }) => file === 'whatsapp-consent.repository.ts')?.text ?? '';
    expect(methodsOf(text)).toEqual(['insert', 'listForUser', 'latest']);
  });

  it('only the two repositories touch the two models (AR-08)', () => {
    const users = sources
      .filter(({ text }) => /@InjectModel\(/.test(text))
      .map(({ file }) => file)
      .sort();
    expect(users).toEqual(['consents.repository.ts', 'whatsapp-consent.repository.ts']);
  });
});

// The two models are reachable only from the privacy module's own repositories, wherever else in
// src/ someone looks (the way admin-access-append-only.spec.ts guards its two collections): another
// module asks ConsentsService / WhatsappConsentService (AR-09), and nothing below Mongoose (driver,
// `.collection(...)`, a connection) is used on them.
describe('SPEC-010 AR-08, AR-09, AR-30: no code outside the repositories reaches the two models', () => {
  const SRC = join(MODULE_DIR, '..');
  const all = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({
      file: file.split('\\').join('/'),
      text: readFileSync(join(SRC, file), 'utf8'),
    }));

  /** The files that may name the models or their collections, and why. */
  const ALLOWED = new Set([
    'privacy/schemas/consent.schema.ts', // defines the model
    'privacy/schemas/whatsapp-consent.schema.ts',
    'privacy/consents.repository.ts', // the only code that injects them
    'privacy/whatsapp-consent.repository.ts',
    'privacy/privacy.module.ts', // registers them (MongooseModule.forFeature)
    'privacy/registry/retained-models.ts', // declares them retained (BR-010-22/23), by name
    'migrations/0008-consent-indexes.migration.ts', // builds their indexes through the driver
  ]);
  const NAMES =
    /\b(ConsentEntity|WhatsappConsentEntity|ConsentSchema|WhatsappConsentSchema)\b|['"](consents|whatsappConsents)['"]/;

  it('finds the whole of src/', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('only the schemas, the two repositories, the module and migration 0008 name them', () => {
    const offenders = all
      .filter(({ file }) => !file.endsWith('.spec.ts') && !ALLOWED.has(file))
      .filter(({ text }) => NAMES.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('every allowed file exists (the allowlist is not stale)', () => {
    const files = new Set(all.map(({ file }) => file));
    for (const file of ALLOWED) expect(files.has(file), file).toBe(true);
  });

  it('no other module injects a model by the names of these two (AR-09)', () => {
    const offenders = all
      .filter(({ file }) => !file.endsWith('.spec.ts') && !file.startsWith('privacy/'))
      .filter(({ text }) => /(getModelToken|InjectModel)\(\s*(Whatsapp)?Consent/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('nothing in privacy/ reaches the driver or a connection below Mongoose', () => {
    const offenders = all
      .filter(({ file }) => file.startsWith('privacy/') && !file.endsWith('.spec.ts'))
      .filter(({ text }) => /\.collection\b|InjectConnection|\.db\b|\$merge|\$out/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
