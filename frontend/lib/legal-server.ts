// Server-side only (it reads serverEnv() through backendFetch). The public legal pages read the
// current documents from the API directly, with no BFF hop and no cookie: the texts are public and
// carry no account data (BR-010-02).
import { backendFetch } from '@/lib/backend';
import { currentLegalSchema, type CurrentLegal } from '@/lib/legal';
import { reportClientError } from '@/lib/report-client-error';

/** The terms and the privacy policy in force now, or null when the API cannot answer. */
export async function fetchCurrentLegal(): Promise<CurrentLegal | null> {
  try {
    const response = await backendFetch('/legal/current', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const parsed = currentLegalSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch (error: unknown) {
    reportClientError(error, { where: 'legal pages' });
    return null;
  }
}
