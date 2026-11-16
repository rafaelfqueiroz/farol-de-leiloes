// BR-001-25, BR-001-29, BR-001-31 (RNF-13): every path of the user schema, classified. A new field
// in UserSchema fails test/integration/profile-allowlist-schema.spec.ts and
// src/users/profile-fields.spec.ts until it is placed in exactly one list here, which is the
// moment someone decides whether an account holder may write it (the answer is almost always no).

/** What the account holder edits through PATCH /auth/profile (BR-001-25). */
export const PROFILE_EDITABLE = ['name', 'phone'] as const;

/** The email is read-only for everyone (BR-001-26, D-63). */
export const EMAIL_READ_ONLY = ['email'] as const;

/** Legacy "complete profile" details, written only by UsersService.updateContactDetails. */
export const CONTACT_DETAILS = ['cpf', 'dateOfBirth', 'sex', 'address'] as const;

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
] as const;

/** Mongoose bookkeeping, not account attributes. */
export const BOOKKEEPING = ['_id', '__v', 'createdAt', 'updatedAt'] as const;

export const ALL_CLASSIFIED: readonly string[] = [
  ...PROFILE_EDITABLE,
  ...EMAIL_READ_ONLY,
  ...CONTACT_DETAILS,
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
};
