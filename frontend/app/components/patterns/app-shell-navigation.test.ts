import { describe, expect, it } from 'vitest';
import messages from '@/messages/pt-BR.json';
import {
  NAV_GROUPS,
  currentItemId,
  formatCount,
  visibleGroups,
} from './app-shell-navigation';

const query = (search = '') => new URLSearchParams(search);
const ids = (role: string) => visibleGroups(role).map((group) => group.id);
const itemIds = (role: string) => visibleGroups(role).flatMap((g) => g.items.map((i) => i.id));

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
    ['free', ['search', 'account'], ['search', 'profile', 'subscription', 'support']],
    [
      'standard',
      ['search', 'tracking', 'account'],
      ['search', 'favorites', 'reminders', 'profile', 'subscription', 'support'],
    ],
    [
      'premium',
      ['search', 'tracking', 'account'],
      ['search', 'favorites', 'reminders', 'profile', 'subscription', 'support'],
    ],
    [
      'admin',
      ['search', 'tracking', 'account', 'admin'],
      ['search', 'favorites', 'reminders', 'profile', 'subscription', 'support', 'coupons'],
    ],
  ])('shows %s only its groups, in the fixed order, without the empty Escritório', (role, groups, items) => {
    expect(ids(role)).toEqual(groups);
    expect(itemIds(role)).toEqual(items);
  });

  it('treats an unknown or empty role as free', () => {
    expect(ids('')).toEqual(ids('free'));
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
    ['/searching', '', null],
    ['/', '', null],
  ])('matches %s?%s to %s', (pathname, search, expected) => {
    expect(currentItemId(visibleGroups('admin'), pathname, query(search))).toBe(expected);
  });

  it('does not mark a destination the role cannot see', () => {
    // a free user on /search?view=favorites sees the search view (the page checks the role too)
    expect(currentItemId(visibleGroups('free'), '/search', query('view=favorites'))).toBe('search');
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
