import type { ReactNode } from 'react';
import EmailVerificationBanner from '@/app/components/account/EmailVerificationBanner';
import AppShell from '@/app/components/patterns/AppShell';
import BillingBanner from '@/app/components/plans/BillingBanner';

// #42 (DESIGN.md §6): one AppShell for every page in the group, never mounted per page. It is
// guest-capable, so the public auction detail shows the guest top bar to visitors and the full
// navigation to signed-in users. SPEC-001 BR-001-04: the unconfirmed-e-mail warning is one banner
// in the shell's slot, so no page needs to know about it. SPEC-012 owner decision 1: an office
// member's billing notice (payment failed, grace, read-only) takes the slot first; the e-mail
// warning is what it holds otherwise.
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell
      banner={
        <BillingBanner>
          <EmailVerificationBanner />
        </BillingBanner>
      }
    >
      {children}
    </AppShell>
  );
}
