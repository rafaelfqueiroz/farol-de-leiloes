'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { LEGAL_PATHS, PRIVACY_PAGE_PATH } from '@/lib/legal';
import TermsReacceptanceDialog from './TermsReacceptanceDialog';
import WhatsappPromptDialog from './WhatsappPromptDialog';

/** Where the dialogs never cover the page: reading the documents, the rights page, the closed screen. */
const PAGES_WITHOUT_DIALOGS: readonly string[] = [
  LEGAL_PATHS.terms,
  LEGAL_PATHS.privacy,
  PRIVACY_PAGE_PATH,
  '/conta-encerrada',
];

/**
 * SPEC-010 BR-010-05, BR-010-27: the one place the two consent dialogs are decided, mounted once in
 * the root layout, so no page knows about them. One question at a time: the new documents first, the
 * one-time WhatsApp question only after, never together. The documents themselves and the rights page
 * stay readable under a pending version (the API exempts them too, DL-010-03), so the dialogs step
 * aside there. UX only: the API refuses account features itself (AR-51).
 */
export default function AccountConsentGate() {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading || !user) return null;
  if (pathname !== null && PAGES_WITHOUT_DIALOGS.includes(pathname)) return null;
  if (user.termsAcceptanceRequired === true) return <TermsReacceptanceDialog />;
  if (user.whatsappPromptPending === true) return <WhatsappPromptDialog />;
  return null;
}
