import type { Metadata } from 'next';
import PrivacyPage from '@/app/components/privacy/PrivacyPage';

// SPEC-010: the rights page of the signed-in account (under the authentication guard of the group).
// It is reachable while a newer version of the terms is still to be accepted: the API exempts the
// privacy routes (BR-010-05, DL-010-03) and the consent dialog steps aside on this path.
// The return of a Google re-authentication carries a one-time code in the address until the app
// removes it (ReauthReturnCapture): no Referer is sent meanwhile, not even to our own subresources.
export const metadata: Metadata = { referrer: 'no-referrer' };

export default function Page() {
  return <PrivacyPage />;
}
