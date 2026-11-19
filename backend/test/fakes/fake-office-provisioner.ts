import type {
  FirstPaymentOffice,
  OfficeProvisioner,
} from '../../src/subscriptions/ports/office-provisioner.js';

/**
 * TS-03: a hand-written fake of the SPEC-011 office provisioner with the contract it must keep:
 * idempotent by `subscriptionRef` (the second call for a ref returns the first's office).
 */
export class FakeOfficeProvisioner implements OfficeProvisioner {
  available = true;
  /** Every call, in order, so a spec can count how often the port was reached. */
  readonly calls: FirstPaymentOffice[] = [];
  /** The offices created, by subscription ref. */
  readonly offices = new Map<string, string>();
  /** Makes the next call fail, as an unreachable office store would. */
  failNext = false;

  async createForFirstPayment(input: FirstPaymentOffice): Promise<{ officeId: string }> {
    this.calls.push(input);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('office store unreachable');
    }
    const existing = this.offices.get(input.subscriptionRef);
    if (existing !== undefined) return { officeId: existing };
    const officeId = `64b7f0000000000000cc${String(this.offices.size + 1).padStart(4, '0')}`;
    this.offices.set(input.subscriptionRef, officeId);
    return { officeId };
  }
}
