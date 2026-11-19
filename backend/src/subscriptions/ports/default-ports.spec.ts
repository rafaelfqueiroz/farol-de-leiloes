// SPEC-012: the defaults the SPEC-011 and billing seams fail closed to, until their specs bind
// their own.
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { NoOfficeMembersSource } from './office-members.source.js';
import { UnavailableOfficeProvisioner } from './office-provisioner.js';
import { NoPaymentFailedNotifier } from './payment-failed.notifier.js';

describe('default SPEC-012 ports', () => {
  it('BR-012-07: no office can be created before SPEC-011: unavailable, and a fault if asked', async () => {
    const provisioner = new UnavailableOfficeProvisioner();

    expect(provisioner.available).toBe(false);
    await expect(provisioner.createForFirstPayment()).rejects.toThrow(
      'OFFICE_PROVISIONER is not bound',
    );
  });

  it('BR-012-20: an office has no member before SPEC-011; the loss is a count in the log, not data', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');

    await expect(new NoOfficeMembersSource().memberContacts()).resolves.toEqual([]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('0 member contacts'));
    warn.mockRestore();
  });

  it('BR-012-20: nobody is told before the billing PR binds the notifier', async () => {
    await expect(new NoPaymentFailedNotifier().notifyPaymentFailed()).resolves.toBeUndefined();
  });
});
