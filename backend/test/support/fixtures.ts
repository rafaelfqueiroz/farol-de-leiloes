// TS-28: captured Caixa pages and lists live under test/fixtures/caixa/. Unit specs sit next to
// their source (TESTING §2), so they resolve fixtures through this helper rather than a path
// relative to their own directory.
import { readFileSync } from 'fs';
import { join } from 'path';

const CAIXA_FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'caixa');

/** Absolute path of a captured Caixa fixture, e.g. `caixaFixturePath('sfi-auction.html')`. */
export function caixaFixturePath(name: string): string {
  return join(CAIXA_FIXTURES, name);
}

/** Contents of a captured Caixa fixture, decoded as UTF-8. */
export function readCaixaFixture(name: string): string {
  return readFileSync(caixaFixturePath(name), 'utf8');
}
