import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import LegalDocumentPage from '@/app/components/legal/LegalDocumentPage';
import { fetchCurrentLegal } from '@/lib/legal-server';

// SPEC-010 BR-010-02: public, in the `(shell)` group with the guest top bar for a visitor. The text
// is read on the server from the API's current version (BR-010-05), so it is in the HTML.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.meta');
  return { title: t('privacy') };
}

export default async function Page() {
  const legal = await fetchCurrentLegal();
  return <LegalDocumentPage kind="privacy" document={legal?.privacy ?? null} />;
}
