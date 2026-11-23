// SPEC-010 BR-010-13: the rules of the "delete my account" confirmation, in one schema. The request
// carries exactly one proof of identity (the current password, or the one-time code of a Google
// re-authentication) and `confirm: true`. The API checks all of it again (AR-51) and decides which
// proof an account may give; this keeps an empty password or an unticked box from ever being sent.
import { z } from 'zod';

const password = z.object({
  method: z.literal('password'),
  password: z.string().min(1, 'passwordRequired'),
  acknowledged: z.literal(true, 'acknowledgeRequired'),
});

const google = z.object({
  method: z.literal('google'),
  googleCode: z.string().min(1, 'googleRequired'),
  acknowledged: z.literal(true, 'acknowledgeRequired'),
});

export const deleteAccountFormSchema = z.discriminatedUnion('method', [password, google]);

export type DeleteAccountFormValues =
  | { method: 'password'; password: string; acknowledged: boolean }
  | { method: 'google'; googleCode: string; acknowledged: boolean };

export type DeleteAccountFormError = 'passwordRequired' | 'googleRequired' | 'acknowledgeRequired';

/** The body of POST /api/privacy/delete-account, or the first thing the form lacks. */
export function deleteAccountBody(
  values: DeleteAccountFormValues,
):
  | { ok: true; body: { password: string; confirm: true } | { googleCode: string; confirm: true } }
  | { ok: false; error: DeleteAccountFormError } {
  const parsed = deleteAccountFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: (parsed.error.issues[0]?.message ?? 'acknowledgeRequired') as DeleteAccountFormError,
    };
  }
  return parsed.data.method === 'password'
    ? { ok: true, body: { password: parsed.data.password, confirm: true } }
    : { ok: true, body: { googleCode: parsed.data.googleCode, confirm: true } };
}
