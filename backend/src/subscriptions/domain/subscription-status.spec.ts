// SPEC-012 BR-012-12, BR-012-08, BR-012-21: the states, which are in effect, and the limit.
import { describe, expect, it } from 'vitest';
import {
  effectiveJourneyLimit,
  IN_EFFECT_STATUSES,
  isInEffect,
  SUBSCRIPTION_STATUSES,
} from './subscription-status.js';

describe('BR-012-12: the five subscription states', () => {
  it('are pending, active, past_due, canceling and lapsed', () => {
    expect([...SUBSCRIPTION_STATUSES]).toEqual([
      'PENDING',
      'ACTIVE',
      'PAST_DUE',
      'CANCELING',
      'LAPSED',
    ]);
  });
});

describe('BR-012-08, BR-012-19, BR-012-20: which states are in effect', () => {
  it.each([
    ['PENDING', false], // BR-012-09: payment not confirmed grants nothing
    ['ACTIVE', true],
    ['PAST_DUE', true], // BR-012-20: stays in effect while the provider retries
    ['CANCELING', true], // BR-012-19: in effect until the paid period ends
    ['LAPSED', false],
  ] as const)('%s → %s', (status, expected) => {
    expect(isInEffect(status)).toBe(expected);
  });

  it('the in-effect list is exactly the three the unique index is built on', () => {
    expect([...IN_EFFECT_STATUSES]).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELING']);
  });
});

describe('BR-012-21: the effective active-journey limit', () => {
  it.each([
    ['ACTIVE', 5, 5],
    ['PAST_DUE', 5, 5],
    ['CANCELING', 2, 2],
    ['LAPSED', 5, 0], // zero from the moment of the lapse
    ['PENDING', 5, 0], // nothing is granted before the provider confirms payment (BR-012-09)
  ] as const)('%s with a copied limit of %i → %i', (status, activeJourneyLimit, expected) => {
    expect(effectiveJourneyLimit({ status, activeJourneyLimit })).toBe(expected);
  });
});
