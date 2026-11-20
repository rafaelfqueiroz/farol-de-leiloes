// SPEC-010 BR-010-03 / AR-30: the acceptance and WhatsApp consent records are proof, so nothing in the
// privacy module may edit or delete a row. The schemas refuse it at runtime (insert-only.ts); this
// is the first line, at review time: the two repositories expose insert and read methods only, and
// no file of privacy/ calls an update, replace, delete or bulk-write operation.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULE_DIR = join(import.meta.dirname, '..', '..', 'src', 'privacy');

const sources = (readdirSync(MODULE_DIR, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
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
    expect(methodsOf(text)).toEqual(['insert', 'countAccepted', 'findAccepted', 'listForUser']);
  });

  it('WhatsappConsentRepository exposes inserts and reads only', () => {
    const text = sources.find(({ file }) => file === 'whatsapp-consent.repository.ts')?.text ?? '';
    expect(methodsOf(text)).toEqual(['insert', 'latest']);
  });

  it('only the two repositories touch the two models (AR-08)', () => {
    const users = sources
      .filter(({ text }) => /@InjectModel\(/.test(text))
      .map(({ file }) => file)
      .sort();
    expect(users).toEqual(['consents.repository.ts', 'whatsapp-consent.repository.ts']);
  });
});
