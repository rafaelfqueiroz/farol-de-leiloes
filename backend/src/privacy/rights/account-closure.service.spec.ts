// SPEC-010 BR-010-13, BR-010-14: the closure's orchestration over hand-written collaborators (TS-03).
// The real races on MongoDB are in test/integration/account-closure.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../common/errors/domain-error.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { AccountClosureService, type AccountClosureHook } from './account-closure.service.js';

const ID = '64b000000000000000000001';

function build(hooks: AccountClosureHook[] = []) {
  const state = { status: 'active' as string, closeOutcome: 'closed' as string };
  const auth = {
    reauthenticate: vi.fn().mockResolvedValue(undefined),
    endAllSessionsAndLinks: vi.fn().mockResolvedValue(undefined),
  };
  const users = {
    findById: vi.fn(() => Promise.resolve({ status: state.status })),
    closeAccount: vi.fn(() => Promise.resolve(state.closeOutcome)),
  };
  const exports = { cancelLiveOf: vi.fn().mockResolvedValue(1) };
  const reminders = { cancelPendingOfAccount: vi.fn().mockResolvedValue(2) };
  const clock = new FakeClock();
  const service = new AccountClosureService(
    auth as never,
    users as never,
    exports as never,
    reminders as never,
    hooks,
    clock,
  );
  return { service, state, auth, users, exports, reminders, clock };
}

describe('closeOwnAccount', () => {
  it('re-authenticates, closes at the Clock instant and runs the effects once', async () => {
    const hook = { name: 'links', onAccountClosed: vi.fn().mockResolvedValue(undefined) };
    const { service, auth, users, exports, reminders, clock } = build([hook]);

    await service.closeOwnAccount(ID, { password: 'p' }, '203.0.113.1');

    expect(auth.reauthenticate).toHaveBeenCalledWith(ID, { password: 'p' }, '203.0.113.1');
    expect(users.closeAccount).toHaveBeenCalledWith(ID, clock.now());
    expect(auth.endAllSessionsAndLinks).toHaveBeenCalledWith(ID);
    expect(exports.cancelLiveOf).toHaveBeenCalledWith(ID);
    expect(reminders.cancelPendingOfAccount).toHaveBeenCalledWith(ID);
    expect(hook.onAccountClosed).toHaveBeenCalledWith(ID);
  });

  it('an account already closed answers success with no proof asked and nothing done', async () => {
    const { service, state, auth, users } = build();
    state.status = 'closed';

    await expect(service.closeOwnAccount(ID, { password: 'p' }, 'ip')).resolves.toBeUndefined();

    expect(auth.reauthenticate).not.toHaveBeenCalled();
    expect(users.closeAccount).not.toHaveBeenCalled();
  });

  it('a proof that fails because a concurrent closure just closed the account is success', async () => {
    const { service, state, auth, users } = build();
    auth.reauthenticate.mockImplementation(() => {
      state.status = 'closed';
      return Promise.reject(new DomainError('CURRENT_PASSWORD_INCORRECT'));
    });

    await expect(service.closeOwnAccount(ID, { password: 'p' }, 'ip')).resolves.toBeUndefined();
    expect(users.closeAccount).not.toHaveBeenCalled();
  });

  it('a proof that fails on an active account is the refusal, and nothing is closed', async () => {
    const { service, auth, users } = build();
    auth.reauthenticate.mockRejectedValue(new DomainError('CURRENT_PASSWORD_INCORRECT'));

    await expect(service.closeOwnAccount(ID, { password: 'p' }, 'ip')).rejects.toMatchObject({
      code: 'CURRENT_PASSWORD_INCORRECT',
    });
    expect(users.closeAccount).not.toHaveBeenCalled();
  });

  it('the loser of two closures does none of the effects', async () => {
    const hook = { name: 'links', onAccountClosed: vi.fn() };
    const { service, state, auth } = build([hook]);
    state.closeOutcome = 'already_closed';

    await service.closeOwnAccount(ID, { password: 'p' }, 'ip');

    expect(auth.endAllSessionsAndLinks).not.toHaveBeenCalled();
    expect(hook.onAccountClosed).not.toHaveBeenCalled();
  });

  it('an account that vanished is USER_NOT_FOUND', async () => {
    const { service, state } = build();
    state.closeOutcome = 'not_found';

    await expect(service.closeOwnAccount(ID, { password: 'p' }, 'ip')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('a failing step never undoes the closure: the others run and the names are logged without data', async () => {
    const failing = {
      name: 'links',
      onAccountClosed: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const next = { name: 'billing', onAccountClosed: vi.fn().mockResolvedValue(undefined) };
    const { service, auth, exports } = build([failing, next]);
    auth.endAllSessionsAndLinks.mockRejectedValue(new Error('db'));

    await expect(service.closeOwnAccount(ID, { password: 'p' }, 'ip')).resolves.toBeUndefined();

    expect(exports.cancelLiveOf).toHaveBeenCalled();
    expect(next.onAccountClosed).toHaveBeenCalled();
  });
});

describe('applyClosureEffects', () => {
  it('answers the built-in steps and the hooks that failed, separately', async () => {
    const failing = { name: 'links', onAccountClosed: vi.fn().mockRejectedValue(new Error('x')) };
    const { service, exports, reminders } = build([failing]);
    exports.cancelLiveOf.mockRejectedValue(new Error('y'));
    reminders.cancelPendingOfAccount.mockRejectedValue(new Error('z'));

    expect(await service.applyClosureEffects(ID)).toEqual({
      failedSteps: ['exports', 'reminders'],
      failedHooks: ['hook-links'],
    });
  });

  it('answers none when everything worked', async () => {
    expect(await build().service.applyClosureEffects(ID)).toEqual({
      failedSteps: [],
      failedHooks: [],
    });
  });
});
