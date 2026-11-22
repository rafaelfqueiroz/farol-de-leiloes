import { describe, expect, it } from 'vitest';
import messages from '@/messages/pt-BR.json';
import {
  NAV_GROUPS,
  currentItemId,
  formatCount,
  isOfficeMember,
  subscriptionHref,
  visibleGroups,
} from './app-shell-navigation';

const query = (search = '') => new URLSearchParams(search);
const as = (role: string, isAdmin = false) => ({ role, isAdmin });
const ids = (role: string, isAdmin = false) =>
  visibleGroups(as(role, isAdmin)).map((group) => group.id);
const itemIds = (role: string, isAdmin = false) =>
  visibleGroups(as(role, isAdmin)).flatMap((g) => g.items.map((i) => i.id));

describe('app-shell navigation config', () => {
  it('has unique item ids', () => {
    const all = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the fixed group order (DESIGN.md §6)', () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual([
      'search',
      'tracking',
      'office',
      'account',
      'admin',
    ]);
  });

  it('has a catalogue label for every group and item (DS-20)', () => {
    const catalogue = messages.patterns.appShell;
    for (const group of NAV_GROUPS) {
      expect(catalogue.groups[group.labelKey]).toBeTruthy();
      for (const item of group.items) expect(catalogue.items[item.labelKey]).toBeTruthy();
    }
  });

  it.each([
    ['free', ['search', 'account'], ['search', 'profile', 'subscription', 'privacy', 'support']],
    [
      'standard',
      ['search', 'tracking', 'account'],
      ['search', 'favorites', 'reminders', 'profile', 'subscription', 'privacy', 'support'],
    ],
    [
      'premium',
      ['search', 'tracking', 'account'],
      ['search', 'favorites', 'reminders', 'profile', 'subscription', 'privacy', 'support'],
    ],
  ])(
    'shows %s only its groups, in the fixed order, without the empty Escritório',
    (role, groups, items) => {
      expect(ids(role)).toEqual(groups);
      expect(itemIds(role)).toEqual(items);
    },
  );

  it('treats an unknown or empty role as free', () => {
    expect(ids('')).toEqual(ids('free'));
  });

  it("SPEC-002 BR-002-23: the legacy role 'admin' is the free plan and shows no admin item", () => {
    expect(itemIds('admin')).toEqual(itemIds('free'));
  });

  it('SPEC-002 BR-002-23: the admin capability adds Administração and no plan feature', () => {
    expect(ids('free', true)).toEqual(['search', 'account', 'admin']);
    expect(itemIds('admin', true)).toEqual([
      'search',
      'profile',
      'subscription',
      'privacy',
      'support',
      'coupons',
    ]);
  });

  it('SPEC-002: an admin on a paid plan keeps that plan and gains Administração', () => {
    expect(itemIds('premium', true)).toEqual([...itemIds('premium'), 'coupons']);
  });

  it('SPEC-012: an office member (the advisor persona) gets the Escritório group with the office plan, and Assinatura opens it', () => {
    const member = { role: 'free', isAdmin: false, personas: ['searcher', 'advisor'] };
    const groups = visibleGroups(member);

    expect(groups.map((group) => group.id)).toEqual(['search', 'office', 'account']);
    expect(groups.find((group) => group.id === 'office')?.items.map((item) => item.href)).toEqual([
      '/office/plan',
    ]);
    const subscription = groups
      .flatMap((group) => group.items)
      .find((i) => i.id === 'subscription');
    expect(subscription?.href).toBe('/office/plan');
    expect(subscriptionHref(member)).toBe('/office/plan');
    expect(isOfficeMember(member)).toBe(true);
  });

  it('SPEC-012: anyone else keeps Assinatura on the catalogue and never sees Escritório', () => {
    for (const other of [
      { role: 'premium', isAdmin: false },
      { role: 'free', isAdmin: true, personas: ['searcher', 'investor'] },
    ]) {
      expect(visibleGroups(other).map((group) => group.id)).not.toContain('office');
      expect(subscriptionHref(other)).toBe('/plans');
      expect(
        visibleGroups(other)
          .flatMap((group) => group.items)
          .find((item) => item.id === 'subscription')?.href,
      ).toBe('/plans');
      expect(isOfficeMember(other)).toBe(false);
    }
  });

  it.each([
    ['/search', '', 'search'],
    ['/search', 'view=favorites', 'favorites'],
    ['/search', 'state=RN&view=favorites', 'favorites'],
    ['/search', 'view=other', 'search'],
    ['/auction/1444419920935', '', 'search'],
    ['/reminders', '', 'reminders'],
    ['/admin/coupons', '', 'coupons'],
    ['/admin/coupons/abc', '', 'coupons'],
    ['/plans', '', 'subscription'],
    ['/office/plan', '', 'officePlan'],
    ['/searching', '', null],
    ['/', '', null],
  ])('matches %s?%s to %s', (pathname, search, expected) => {
    expect(
      currentItemId(
        visibleGroups({ ...as('premium', true), personas: ['advisor'] }),
        pathname,
        query(search),
      ),
    ).toBe(expected);
  });

  it('does not mark a destination the role cannot see', () => {
    // a free user on /search?view=favorites sees the search view (the page checks the role too)
    expect(currentItemId(visibleGroups(as('free')), '/search', query('view=favorites'))).toBe(
      'search',
    );
  });

  it.each([
    [undefined, null],
    [0, null],
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [1250, '99+'],
  ])('formats the count %s as %s', (count, expected) => {
    expect(formatCount(count)).toBe(expected);
  });
});
