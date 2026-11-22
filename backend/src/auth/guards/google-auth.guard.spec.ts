// SPEC-010 BR-010-13: the start of a Google RE-AUTHENTICATION asks Google for an interactive login
// (`prompt=login`); an ordinary sign-in sends no extra option and is unchanged.
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { GoogleAuthGuard } from './google-auth.guard.js';

const options = (query: Record<string, unknown> | undefined) =>
  new GoogleAuthGuard().getAuthenticateOptions({
    switchToHttp: () => ({ getRequest: () => ({ query }) }),
  } as unknown as ExecutionContext);

describe('GoogleAuthGuard.getAuthenticateOptions', () => {
  it("forces Google's own login for intent=reauth", () => {
    expect(options({ intent: 'reauth' })).toEqual({ prompt: 'login' });
  });

  it.each([
    ['no query', undefined],
    ['no intent', {}],
    ['another intent', { intent: 'admin' }],
    ['an empty intent', { intent: '' }],
    ['the intent twice', { intent: ['reauth', 'reauth'] }],
    ['the word in another parameter', { next: 'reauth' }],
  ])('sends no option for %s: a normal sign-in does not change', (_label, query) => {
    expect(options(query)).toBeUndefined();
  });
});
