// SPEC-002 BR-002-23..BR-002-26: SupportGrantService over an in-memory grant store (TS-03) and the
// real AccessContextFactory over fake relationships. The HTTP-level proofs, on MongoDB with the
// real partial unique index, are in test/isolation/support-grants.isolation.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AccessContext } from '../access/access-context.js';
import type {
  SupportRequestForGrant,
  SupportRequestSource,
} from '../access/sources/support-request.source.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { UsersService } from '../users/users.service.js';
import {
  accessContextFactory,
  anAccessContext,
  fakeAccessSources,
} from '../../test/fakes/fake-access-sources.js';
import { DAY, FakeClock, MINUTE } from '../../test/fakes/fake-clock.js';
import type { GrantEndReason } from './domain/grant-validity.js';
import type {
  NewGrant,
  StoredGrant,
  SupportAccessGrantRepository,
} from './support-access-grant.repository.js';
import { SupportGrantRead, SupportGrantService } from './support-grant.service.js';

const ADMIN = '64b7f0000000000000000a01';
const OTHER_ADMIN = '64b7f0000000000000000a02';
const REQUESTER = '64b7f0000000000000000b01';
const ADMIN_REQUESTER = '64b7f0000000000000000b02';
const CLOSED_ACCOUNT = '64b7f0000000000000000b03';
const MISSING_ACCOUNT = '64b7f0000000000000000b04';
const REQUEST = '64b7f0000000000000000c01';
const OTHER_REQUEST = '64b7f0000000000000000c02';
const OFFICE = '64b7f0000000000000000d01';

/** In-memory grants with the partial unique index's rule: one open grant per request. */
class InMemoryGrants {
  rows: StoredGrant[] = [];
  private next = 1;
  /** Makes the next insert lose a race to a grant that ends before it is read. */
  vanishingRival = false;

  insertOpen(grant: NewGrant): Promise<StoredGrant | null> {
    if (this.vanishingRival) {
      this.vanishingRival = false;
      return Promise.resolve(null);
    }
    if (
      this.rows.some((r) => r.supportRequestId === grant.supportRequestId && r.status === 'open')
    ) {
      return Promise.resolve(null);
    }
    const row: StoredGrant = {
      id: `64b7f00000000000000ee${String(this.next++).padStart(3, '0')}`,
      ...grant,
      status: 'open',
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findForAdmin(grantId: string, adminUserId: string): Promise<StoredGrant | null> {
    return Promise.resolve(
      this.rows.find((r) => r.id === grantId && r.adminUserId === adminUserId) ?? null,
    );
  }

  findOpenForSupportRequest(supportRequestId: string): Promise<StoredGrant | null> {
    return Promise.resolve(
      this.rows.find((r) => r.supportRequestId === supportRequestId && r.status === 'open') ?? null,
    );
  }

  endIfOpen(grantId: string, endedAt: Date, endReason: GrantEndReason): Promise<boolean> {
    return Promise.resolve(this.end((r) => r.id === grantId, endedAt, endReason));
  }

  endOpenForSupportRequest(
    supportRequestId: string,
    endedAt: Date,
    endReason: GrantEndReason,
  ): Promise<boolean> {
    return Promise.resolve(
      this.end((r) => r.supportRequestId === supportRequestId, endedAt, endReason),
    );
  }

  private end(match: (r: StoredGrant) => boolean, endedAt: Date, endReason: GrantEndReason) {
    const index = this.rows.findIndex((r) => match(r) && r.status === 'open');
    const row = this.rows[index];
    if (!row) return false;
    this.rows[index] = { ...row, status: 'ended', endedAt, endReason };
    return true;
  }
}

class FakeSupportRequests implements SupportRequestSource {
  requests = new Map<string, SupportRequestForGrant>();

  set(request: SupportRequestForGrant): void {
    this.requests.set(request.id, request);
  }

  findForGrant(id: string): Promise<SupportRequestForGrant | null> {
    return Promise.resolve(this.requests.get(id) ?? null);
  }
}

const shared = (overrides: Partial<SupportRequestForGrant> = {}): SupportRequestForGrant => ({
  id: REQUEST,
  requesterUserId: REQUESTER,
  open: true,
  dataAccessAllowed: true,
  ...overrides,
});

const notFound = new DomainError('NOT_FOUND');
const forbidden = new DomainError('FORBIDDEN');

describe('SupportGrantService (SPEC-002 BR-002-23..BR-002-26)', () => {
  let grants: InMemoryGrants;
  let requests: FakeSupportRequests;
  let clock: FakeClock;
  let service: SupportGrantService;
  let admin: AccessContext;
  let otherAdmin: AccessContext;

  beforeEach(async () => {
    grants = new InMemoryGrants();
    requests = new FakeSupportRequests();
    clock = new FakeClock();
    const accounts = new Map<string, { isAdmin?: boolean; status?: string }>([
      [REQUESTER, {}],
      [ADMIN_REQUESTER, { isAdmin: true }],
      [CLOSED_ACCOUNT, { status: 'closed' }],
    ]);
    const users = {
      findById: (id: string) => Promise.resolve(accounts.get(id) ?? null),
    } as unknown as UsersService;
    const sources = fakeAccessSources();
    sources.fake.forAccount(REQUESTER, {
      memberships: [{ officeId: OFFICE }],
      officePlans: { [OFFICE]: { advisorPlanActive: true, readOnly: false, entitlements: ['x'] } },
    });
    service = new SupportGrantService(
      grants as unknown as SupportAccessGrantRepository,
      requests,
      users,
      accessContextFactory(sources),
      clock,
    );
    admin = await anAccessContext(ADMIN, {}, true);
    otherAdmin = await anAccessContext(OTHER_ADMIN, {}, true);
    requests.set(shared());
  });

  describe('open (BR-002-24)', () => {
    it('opens a grant for an open request whose requester allowed data access, for 7 days', async () => {
      const opened = await service.open(admin, REQUEST);

      expect(opened).toEqual({
        id: grants.rows[0]?.id,
        supportRequestId: REQUEST,
        openedAt: clock.now(),
        expiresAt: new Date(clock.now().getTime() + 7 * DAY),
      });
      expect(grants.rows[0]).toMatchObject({ adminUserId: ADMIN, requesterUserId: REQUESTER });
    });

    it('is refused to an account without the admin capability (BR-002-23)', async () => {
      const member = await anAccessContext(REQUESTER, { memberships: [{ officeId: OFFICE }] });
      await expect(service.open(member, REQUEST)).rejects.toEqual(forbidden);
    });

    it.each([
      ['a request that does not exist', OTHER_REQUEST, undefined],
      ['a malformed id', 'not-an-id', undefined],
      ['a closed request', REQUEST, shared({ open: false })],
      ['a request without data access allowed', REQUEST, shared({ dataAccessAllowed: false })],
      [
        'a requester who is an admin (BR-002-21)',
        REQUEST,
        shared({ requesterUserId: ADMIN_REQUESTER }),
      ],
      ['a requester no longer active', REQUEST, shared({ requesterUserId: CLOSED_ACCOUNT })],
      ['a requester with no account', REQUEST, shared({ requesterUserId: MISSING_ACCOUNT })],
      ['a requester id that is no id', REQUEST, shared({ requesterUserId: 'nobody' })],
      ['a source answering another request', REQUEST, shared({ id: OTHER_REQUEST })],
    ])('answers %s with the same NOT_FOUND as a nonexistent request', async (_c, id, request) => {
      if (request) {
        requests.requests.clear();
        requests.requests.set(REQUEST, request);
      }
      await expect(service.open(admin, id)).rejects.toEqual(notFound);
      expect(grants.rows).toEqual([]);
    });

    it('is idempotent for the same admin: one grant, the same answer', async () => {
      const first = await service.open(admin, REQUEST);
      clock.advance(MINUTE);
      expect(await service.open(admin, REQUEST)).toEqual(first);
      expect(grants.rows).toHaveLength(1);
    });

    it('is FORBIDDEN while another admin holds the request’s open grant', async () => {
      await service.open(admin, REQUEST);
      await expect(service.open(otherAdmin, REQUEST)).rejects.toEqual(forbidden);
    });

    it('ends an expired open grant in the way and opens a new one', async () => {
      const first = await service.open(admin, REQUEST);
      clock.advance(7 * DAY);

      const second = await service.open(otherAdmin, REQUEST);

      expect(second.id).not.toBe(first.id);
      expect(grants.rows[0]).toMatchObject({ status: 'ended', endReason: 'expired' });
    });

    it('inserts again when the grant it collided with ended in between', async () => {
      grants.vanishingRival = true;
      await service.open(admin, REQUEST);
      expect(grants.rows).toHaveLength(1);
    });

    it('fails as a fault when the grant keeps reappearing', async () => {
      grants.insertOpen = () => Promise.resolve(null);
      grants.findOpenForSupportRequest = () => Promise.resolve(null);
      await expect(service.open(admin, REQUEST)).rejects.toThrow('several attempts');
    });
  });

  describe('contextForRead (BR-002-25, BR-002-26)', () => {
    it('builds the requester’s current context, read-only, for the grant’s admin', async () => {
      const { id } = await service.open(admin, REQUEST);

      const read = await service.contextForRead(admin, id);

      expect(read).toBeInstanceOf(SupportGrantRead);
      expect(read).toMatchObject({
        grantId: id,
        supportRequestId: REQUEST,
        adminUserId: ADMIN,
        requesterUserId: REQUESTER,
      });
      expect(read.context.accountId).toBe(REQUESTER);
      expect(read.context.isAdmin).toBe(false);
      expect(read.context.readOnly).toBe(true);
      expect(read.context.conductedOwners()).toEqual([{ ownerType: 'office', ownerId: OFFICE }]);
      expect(read.context.writableOwners()).toEqual([]);
      expect(read.context.canWriteWith('x')).toBe(false);
    });

    it('is bound to its admin: another admin, a non-admin and a missing id get NOT_FOUND', async () => {
      const { id } = await service.open(admin, REQUEST);
      const member = await anAccessContext(REQUESTER, { memberships: [{ officeId: OFFICE }] });

      await expect(service.contextForRead(otherAdmin, id)).rejects.toEqual(notFound);
      await expect(service.contextForRead(member, id)).rejects.toEqual(notFound);
      await expect(service.contextForRead(admin, OTHER_REQUEST)).rejects.toEqual(notFound);
    });

    it.each([
      ['closed', shared({ open: false }), 'closed'],
      ['withdrawn', shared({ dataAccessAllowed: false }), 'withdrawn'],
      ['gone', undefined, 'closed'],
      ['now naming another requester', shared({ requesterUserId: CLOSED_ACCOUNT }), 'closed'],
    ] as const)(
      'refuses the next read once the request is %s, and records the end',
      async (_case, request, reason) => {
        const { id } = await service.open(admin, REQUEST);
        requests.requests.clear();
        if (request) requests.set(request);

        await expect(service.contextForRead(admin, id)).rejects.toEqual(notFound);
        expect(grants.rows[0]).toMatchObject({ status: 'ended', endReason: reason });
        expect(grants.rows[0]?.endedAt).toEqual(clock.now());
        // Ended for good: an open request again does not reopen it.
        requests.set(shared());
        await expect(service.contextForRead(admin, id)).rejects.toEqual(notFound);
      },
    );

    it('refuses a grant opened 7 days and 1 minute ago, recording the expiry instant', async () => {
      const { id, expiresAt } = await service.open(admin, REQUEST);
      clock.advance(7 * DAY + MINUTE);

      await expect(service.contextForRead(admin, id)).rejects.toEqual(notFound);
      expect(grants.rows[0]).toMatchObject({
        status: 'ended',
        endReason: 'expired',
        endedAt: expiresAt,
      });
    });

    it('refuses at exactly 7 days and accepts a millisecond before', async () => {
      const { id } = await service.open(admin, REQUEST);
      clock.advance(7 * DAY - 1);
      await expect(service.contextForRead(admin, id)).resolves.toBeInstanceOf(SupportGrantRead);
      clock.advance(1);
      await expect(service.contextForRead(admin, id)).rejects.toEqual(notFound);
    });

    it('refuses the view of a requester who became an admin or was closed, without ending it', async () => {
      const { id } = await service.open(admin, REQUEST);
      const findById = (service as unknown as { users: { findById: unknown } }).users;
      findById.findById = () => Promise.resolve({ isAdmin: true });

      await expect(service.contextForRead(admin, id)).rejects.toEqual(notFound);
      expect(grants.rows[0]?.status).toBe('open');
    });
  });

  describe('endForSupportRequest (BR-002-26)', () => {
    it('ends the open grant of the request at the current time, once', async () => {
      const { id } = await service.open(admin, REQUEST);

      expect(await service.endForSupportRequest(REQUEST, 'withdrawn')).toBe(true);
      expect(await service.endForSupportRequest(REQUEST, 'closed')).toBe(false);

      expect(grants.rows[0]).toMatchObject({ status: 'ended', endReason: 'withdrawn' });
      await expect(service.contextForRead(admin, id)).rejects.toEqual(notFound);
    });
  });

  it('a SupportGrantRead cannot be built outside the service', () => {
    const Ctor = SupportGrantRead as unknown as new (token: symbol, fields: object) => unknown;
    expect(() => new Ctor(Symbol('forged'), {})).toThrow('contextForRead only');
  });
});
