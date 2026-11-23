// SPEC-001 BR-001-13, SPEC-010 BR-010-01, BR-010-27: the rules of the sign-up form, in one schema.
// The messages are catalogue codes (`register.errors.<code>`, `account.terms.required`), turned into
// text at render (DS-20). The API validates everything again (AR-51); this only saves the round trip.
import { z } from 'zod';

export const MIN_PASSWORD_LENGTH = 8; // SPEC-001 BR-001-13
export const MAX_PASSWORD_LENGTH = 128; // SPEC-001 BR-001-13

export const REGISTER_FIELDS = [
  'name',
  'email',
  'password',
  'confirmPassword',
  'acceptTerms',
] as const;
export type RegisterField = (typeof REGISTER_FIELDS)[number];

export const registerFormSchema = z.object({
  name: z.string().trim().min(1, 'required'),
  email: z.string().trim().min(1, 'required'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, 'passwordLength')
    .max(MAX_PASSWORD_LENGTH, 'passwordLength'),
  confirmPassword: z.string(),
  // BR-010-01: nothing is created unless the person accepted what they were shown
  acceptTerms: z.literal(true, 'termsRequired'),
  // BR-010-27: its own choice; never required, never ticked for the person
  whatsappConsent: z.boolean(),
});

/** What the form holds; `acceptTerms` is a plain checkbox state until the schema judges it. */
export interface RegisterFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  acceptTerms: boolean;
  whatsappConsent: boolean;
}
export type RegisterFormErrorCode =
  'required' | 'passwordLength' | 'passwordMismatch' | 'termsRequired';

/** The first error of each field, as the catalogue code. An empty object means the form is valid. */
export function registerFormErrors(
  values: RegisterFormValues,
): Partial<Record<RegisterField, RegisterFormErrorCode>> {
  const parsed = registerFormSchema.safeParse(values);
  const errors: Partial<Record<RegisterField, RegisterFormErrorCode>> = {};
  // a cross-field rule is checked here, not as an object refinement: zod skips a refinement while
  // another field is invalid, and the person should see every broken field at once
  if (values.password !== values.confirmPassword) errors.confirmPassword = 'passwordMismatch';
  if (parsed.success) return errors;
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || !(REGISTER_FIELDS as readonly string[]).includes(field))
      continue;
    const key = field as RegisterField;
    errors[key] ??= issue.message as RegisterFormErrorCode;
  }
  return errors;
}
