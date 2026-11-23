'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { currentLegalSchema, type CurrentLegal } from '@/lib/legal';
import { reportClientError } from '@/lib/report-client-error';

export type LegalState =
  | { status: 'loading' }
  | { status: 'failed'; error: unknown }
  | { status: 'ready'; legal: CurrentLegal };

/**
 * SPEC-010 BR-010-01, BR-010-05: the versions of the terms and the privacy policy in force NOW,
 * read from the public API. A form or dialog shows these and sends exactly these back, so an
 * acceptance can only be recorded for a text the person was shown. `reload` reads them again (a
 * newer version was published while the person read).
 */
export function useCurrentLegal(): { state: LegalState; reload: () => void } {
  const [state, setState] = useState<LegalState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const body = await apiJson<unknown>('/api/legal/current');
        if (cancelled) return;
        const parsed = currentLegalSchema.safeParse(body);
        setState(
          parsed.success
            ? { status: 'ready', legal: parsed.data }
            : { status: 'failed', error: new Error('legal documents shape') },
        );
      } catch (error: unknown) {
        if (cancelled) return;
        reportClientError(error, { where: 'useCurrentLegal' });
        setState({ status: 'failed', error });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);

  return { state, reload };
}
