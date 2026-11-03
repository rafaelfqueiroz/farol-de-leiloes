// AR-39 / DV-37: every code in the API's catalogue (AR-37) has a pt-BR message under `errors` in
// the frontend. The frontend runs the same check, but a backend-only push skips the frontend tests
// (pre-push selection), so the backend mirrors it: a code added here without a message fails here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ERROR_CODES } from '../../src/common/errors/codes';

const MESSAGES = join(__dirname, '..', '..', '..', 'frontend', 'messages', 'pt-BR.json');

describe('AR-39: error codes have a pt-BR message', () => {
  const messages = JSON.parse(readFileSync(MESSAGES, 'utf8')) as { errors: Record<string, string> };

  it('has an errors.<CODE> entry in frontend/messages/pt-BR.json for every backend code', () => {
    const missing = ERROR_CODES.filter((code) => !messages.errors[code]);
    expect(missing, 'codes without a message in frontend/messages/pt-BR.json').toEqual([]);
  });
});
