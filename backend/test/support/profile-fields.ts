// BR-001-25, BR-001-29, BR-001-31 (RNF-13): every path of the user schema, classified. A new field
// in UserSchema fails test/integration/profile-allowlist-schema.spec.ts and
// src/users/profile-fields.spec.ts until it is placed in exactly one list here, which is the
// moment someone decides whether an account holder may write it (the answer is almost always no).

/** What the account holder edits through PATCH /auth/profile (BR-001-25). */
export const PROFILE_EDITABLE = ['name', 'phone'] as const;

/** The email is read-only for everyone (BR-001-26, D-63). */
export const EMAIL_READ_ONLY = ['email'] as const;

/**
 * Personal fields that are NOT part of the user schema and must never be again (SC-26, SPEC-010
 * BR-010-06): erased from the collection by migration 0011-erase-legacy-profile-fields (owner decision
 * on issue #10, 2026-11-23). They are deliberately outside `ALL_CLASSIFIED`: a schema path with one of
 * these names fails test/structural/no-erased-personal-fields.spec.ts. They stay here only so the
 * hostile-input tests keep proving that no write path can put them back.
 */
export const ERASED_PERSONAL = ['cpf', 'dateOfBirth', 'sex', 'address'] as const;

/** Written only by the server flow that owns them, never from a profile request (BR-001-30). */
export const PROTECTED = [
  'password',
  'googleId',
  'providers',
  'emailVerified',
  'status',
  'role',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'subscriptionStatus',
  'credentialVersion',
  // SPEC-002 BR-002-21: only the grant-admin script sets it (UsersService.setAdminCapability).
  'isAdmin',
  // SPEC-010 BR-010-27: set by sign-up and the privacy routes (WhatsappConsentService) only.
  'whatsappPromptAnsweredAt',
  // SPEC-010 DL-001-02: set only by the Google takeover of an unconfirmed account (UsersService).
  'consentResetAt',
  // SPEC-010 BR-010-14, BR-010-15: closure and the purge's claim and tombstone instants, written by
  // UsersService.closeAccount and the purge job only (no request body reaches them).
  'closedAt',
  'purgedAt',
  'purgeClaimToken',
  'purgeClaimUntil',
  // SPEC-010 BR-010-15: the purge's fairness stamp and the residue sweep's instants, written by the
  // claim and the tombstone (UsersService) only.
  'lastPurgeAttemptAt',
  'purgeAttempts',
  'residueSweepDueAt',
  'residueSweptAt',
] as const;

/** Mongoose bookkeeping, not account attributes. */
export const BOOKKEEPING = ['_id', '__v', 'createdAt', 'updatedAt'] as const;

export const ALL_CLASSIFIED: readonly string[] = [
  ...PROFILE_EDITABLE,
  ...EMAIL_READ_ONLY,
  ...PROTECTED,
  ...BOOKKEEPING,
];

/** A value a hostile request would try to put in each non-editable path. */
export const HOSTILE_VALUES: Record<string, unknown> = {
  email: 'taken-over@example.test',
  cpf: '99999999999',
  dateOfBirth: '1980-02-02',
  sex: 'female',
  address: { street: 'Rua Hostil', city: 'Cidade', state: 'XX', zipCode: '00000000' },
  password: 'hacked password',
  googleId: 'google-hostile',
  providers: ['google', 'local'],
  emailVerified: true,
  status: 'closed',
  role: 'admin',
  stripeCustomerId: 'cus_hostile',
  stripeSubscriptionId: 'sub_hostile',
  subscriptionStatus: 'active',
  credentialVersion: 99,
  isAdmin: true,
  whatsappPromptAnsweredAt: '2000-01-01T00:00:00.000Z',
  consentResetAt: '2000-01-01T00:00:00.000Z',
  closedAt: '2000-01-01T00:00:00.000Z',
  purgedAt: '2000-01-01T00:00:00.000Z',
  purgeClaimToken: 'hostile-claim',
  purgeClaimUntil: '2999-01-01T00:00:00.000Z',
  lastPurgeAttemptAt: '2000-01-01T00:00:00.000Z',
  purgeAttempts: 0,
  residueSweepDueAt: '2000-01-01T00:00:00.000Z',
  residueSweptAt: '2000-01-01T00:00:00.000Z',
};
