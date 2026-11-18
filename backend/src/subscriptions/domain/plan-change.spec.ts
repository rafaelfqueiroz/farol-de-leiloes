// SPEC-012 BR-012-16..BR-012-18: what choosing another plan does.
import { describe, expect, it } from 'vitest';
import { classifyPlanChange } from './plan-change.js';

const ON_5 = { planId: 'p5', activeJourneyLimit: 5, scheduledPlanId: null };

describe('classifyPlanChange', () => {
  it('BR-012-16: a higher limit is an upgrade, now', () => {
    expect(classifyPlanChange(ON_5, { id: 'p10', activeJourneyLimit: 10 })).toBe('upgrade');
  });

  it('BR-012-17: a lower limit is scheduled for the next period', () => {
    expect(classifyPlanChange(ON_5, { id: 'p2', activeJourneyLimit: 2 })).toBe('schedule');
  });

  it('BR-012-17: another plan with the SAME limit is scheduled too, not applied at once', () => {
    expect(classifyPlanChange(ON_5, { id: 'p5y', activeJourneyLimit: 5 })).toBe('schedule');
  });

  it('BR-012-18: the journeys in progress do not matter: only limits are compared', () => {
    // 4 journeys in progress on a limit-5 plan, downgrade to 2: scheduled, never refused.
    expect(classifyPlanChange(ON_5, { id: 'p2', activeJourneyLimit: 2 })).toBe('schedule');
  });

  it('BR-012-04: the comparison uses the limit the subscription copied, not the catalog today', () => {
    // The subscription copied 3 when the plan had 3; the catalog says 8 now. Target 5 is higher.
    const copied = { planId: 'p-old', activeJourneyLimit: 3, scheduledPlanId: null };
    expect(classifyPlanChange(copied, { id: 'p5', activeJourneyLimit: 5 })).toBe('upgrade');
  });

  it('BR-012-17: choosing the plan in effect changes nothing', () => {
    expect(classifyPlanChange(ON_5, { id: 'p5', activeJourneyLimit: 5 })).toBe('keep');
  });

  it('BR-012-17: choosing the plan in effect while a downgrade is scheduled releases the schedule', () => {
    expect(
      classifyPlanChange({ ...ON_5, scheduledPlanId: 'p2' }, { id: 'p5', activeJourneyLimit: 5 }),
    ).toBe('release_schedule');
  });

  it('BR-012-17: choosing the plan already scheduled changes nothing', () => {
    expect(
      classifyPlanChange({ ...ON_5, scheduledPlanId: 'p2' }, { id: 'p2', activeJourneyLimit: 2 }),
    ).toBe('keep');
  });

  it('BR-012-16: an upgrade while another downgrade is scheduled is still an upgrade', () => {
    expect(
      classifyPlanChange({ ...ON_5, scheduledPlanId: 'p2' }, { id: 'p10', activeJourneyLimit: 10 }),
    ).toBe('upgrade');
  });
});
