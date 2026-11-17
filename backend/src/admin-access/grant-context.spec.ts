// SPEC-002 BR-002-25 / BR-002-27: the seal on a grant's view seals only a grant view, once, and
// opens only what it sealed. Who may call it is test/structural/support-grant-seal.spec.ts.
import { describe, expect, it } from 'vitest';
import { accessContextFactory } from '../../test/fakes/fake-access-sources.js';
import { grantContextOf, sealGrantContext } from './grant-context.js';

const ACCOUNT = '64b7f0000000000000000b01';

describe('grant-context seal', () => {
  const factory = accessContextFactory();
  const own = () => factory.forAccount({ userId: ACCOUNT, isAdmin: false });

  it('seals a grant view and opens it for the same read only', async () => {
    const view = factory.supportGrantView(await own());
    const read = {};

    sealGrantContext(read, view);

    expect(grantContextOf(read)).toBe(view);
    expect(() => grantContextOf({})).toThrow('contextForRead');
  });

  it('refuses to seal an account’s own context (not a grant view)', async () => {
    const ctx = await own();
    expect(() => sealGrantContext({}, ctx)).toThrow('BR-002-25');
  });

  it('seals a read once', async () => {
    const read = {};
    sealGrantContext(read, factory.supportGrantView(await own()));
    const again = factory.supportGrantView(await own());
    expect(() => sealGrantContext(read, again)).toThrow('sealed once');
  });
});
