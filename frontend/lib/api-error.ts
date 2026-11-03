// AR-37/AR-38: every non-2xx answer from the API has the body `{ code, context }`. The browser
// never shows a backend sentence: it turns the code into pt-BR text through the next-intl
// catalogue, `errors.<CODE>` (AR-39). A code the catalogue does not know shows `errors.UNKNOWN`.
// AR-40: the context carries ids and counts only, so interpolating it is safe.
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { z } from 'zod';

/** The codes only the frontend produces; the backend's live in `backend/src/common/errors/codes.ts`. */
export const FRONTEND_ERROR_CODES = ['UNKNOWN', 'BACKEND_UNAVAILABLE'] as const;

export type ErrorContextValue = string | number | boolean | string[];
export type ErrorContext = Record<string, ErrorContextValue>;

const apiErrorBodySchema = z.object({
  code: z.string().min(1),
  context: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
    .default({}),
});

/** A non-2xx answer from the API, with the code and context it carried and its HTTP status. */
export class ApiError extends Error {
  readonly code: string;
  readonly context: ErrorContext;
  readonly status: number;

  constructor(code: string, context: ErrorContext = {}, status = 0) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.context = context;
    this.status = status;
  }
}

/**
 * Reads the error body of a non-2xx response. A body that is not JSON, or not `{ code, context }`,
 * becomes `UNKNOWN`, so callers always get an `ApiError` they can pass to `useApiErrorMessage`.
 */
export async function readApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new ApiError('UNKNOWN', {}, response.status);
  }
  const parsed = apiErrorBodySchema.safeParse(body);
  if (!parsed.success) return new ApiError('UNKNOWN', {}, response.status);
  return new ApiError(parsed.data.code, parsed.data.context, response.status);
}

// ICU values are primitives; a list (`fields`, `requiredRoles`) reads as a comma-separated string.
// AR-37: codes are UPPER_SNAKE_CASE. Anything else off the wire is not looked up (no `a.b` paths).
const CODE_SHAPE = /^[A-Z][A-Z0-9_]*$/;

type IcuValues = Record<string, string | number | boolean>;

function icuValues(context: ErrorContext): IcuValues {
  return Object.fromEntries(
    Object.entries(context).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(', ') : value,
    ]),
  );
}

/**
 * The pt-BR text for whatever was thrown (AR-39): an `ApiError` whose code the catalogue knows
 * gets its own message, with the context interpolated; anything else (a network failure, a code
 * added to the API before the catalogue) gets `errors.UNKNOWN`.
 */
export function useApiErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown): string => {
      const { code, context } =
        error instanceof ApiError ? error : { code: 'UNKNOWN', context: {} as ErrorContext };
      // the key is dynamic by nature (it comes off the wire), so it cannot satisfy the typed keys
      const key =
        CODE_SHAPE.test(code) && (t.has as (key: string) => boolean)(code) ? code : 'UNKNOWN';
      return (t as unknown as (key: string, values: IcuValues) => string)(key, icuValues(context));
    },
    [t],
  );
}
