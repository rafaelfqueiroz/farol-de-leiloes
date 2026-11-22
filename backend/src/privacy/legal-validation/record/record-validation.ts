// SPEC-010 BR-010-26: the arguments and the rules of `npm run legal:record-validation`, the ONLY way a
// lawyer's validation enters the system (no HTTP endpoint writes one, BR-010-25). Pure: no I/O and no
// Nest, so it is unit-tested (TS-01); run.ts wires it to the database and prints the outcome.
//
//   npm run legal:record-validation -- --scope <scope> --validator "<name>" \
//        [--versions terms:1.0,privacy:1.0] [--reference <id>] [--retention-years <n>]
//
// Validated in full with Zod before anything reaches the database (DEVELOPMENT §1). A version must
// exist in the legal registry and must not be a draft placeholder: a text still marked
// "RASCUNHO — pendente de revisão jurídica" cannot be validated, so a validation always names a text
// that is final. SC-15: no message here echoes the validator's name, the reference or a rejected value.
import { z } from 'zod';
import {
  documentTypeOfScope,
  documentVersionKey,
  LEGAL_VALIDATION_SCOPES,
  type LegalValidationScope,
  parseDocumentVersionKey,
} from '../../domain/legal-validation.js';

export const RECORD_VALIDATION_USAGE =
  'usage: npm run legal:record-validation -- --scope <third-party-processing|retention-periods|privacy-policy|terms> ' +
  '--validator "<name>" [--versions terms:1.0,privacy:1.0] [--reference <id>] [--retention-years <n>]';

const FLAGS: Readonly<
  Record<string, 'scope' | 'validator' | 'versions' | 'reference' | 'retentionYears'>
> = {
  '--scope': 'scope',
  '--validator': 'validator',
  '--versions': 'versions',
  '--reference': 'reference',
  '--retention-years': 'retentionYears',
};

const inputSchema = z
  .object({
    scope: z.enum(LEGAL_VALIDATION_SCOPES),
    validator: z.string().trim().min(2).max(120),
    versions: z
      .string()
      .transform((list) => list.split(',').map((key) => key.trim()))
      .pipe(z.array(z.string().min(1)).min(1).max(10))
      .optional(),
    reference: z.string().trim().min(1).max(120).optional(),
    retentionYears: z
      .string()
      .regex(/^[1-9]\d{0,2}$/, 'a whole number of years, at least 1')
      .transform(Number)
      .optional(),
  })
  .strict();

/** The validated arguments. `versions` are `<type>:<version>` keys, not yet checked against the registry. */
export interface RecordValidationInput {
  readonly scope: LegalValidationScope;
  readonly validator: string;
  readonly versions: readonly string[];
  readonly reference?: string;
  readonly retentionYears?: number;
}

export type RecordValidationArgs =
  { ok: true; input: RecordValidationInput } | { ok: false; error: string };

/** `--flag value` or `--flag=value`. An unknown or repeated flag is refused without echoing it. */
export function parseRecordValidationArgs(argv: readonly string[]): RecordValidationArgs {
  const raw: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const [flag = '', ...inline] = arg.split('=');
    const field = FLAGS[flag];
    if (field === undefined || field in raw) {
      return { ok: false, error: `unknown or repeated argument; ${RECORD_VALIDATION_USAGE}` };
    }
    const value = inline.length > 0 ? inline.join('=') : argv[index + 1];
    if (inline.length === 0) index += 1;
    if (value === undefined) {
      return { ok: false, error: `${flag} needs a value; ${RECORD_VALIDATION_USAGE}` };
    }
    raw[field] = value;
  }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    // Field names and the rule that failed; never the value (the validator's name, a reference).
    const where = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: `invalid arguments (${where}); ${RECORD_VALIDATION_USAGE}` };
  }
  const { versions, ...rest } = parsed.data;
  return { ok: true, input: { ...rest, versions: [...new Set(versions ?? [])] } };
}

/** One published text of the legal registry, as the checks need it. */
export interface RegistryEntry {
  readonly type: string;
  readonly version: string;
  readonly draft: boolean;
}

/** What will be written, or why not. */
export type ValidationPlan =
  | {
      ok: true;
      scope: LegalValidationScope;
      validatorName: string;
      documentVersions: string[];
      reference?: string;
      retentionYears?: number;
    }
  | { ok: false; reason: string };

/**
 * BR-010-26: checks the input against the legal registry and the scope. Refuses a version that is not
 * in the registry, a version that is still a draft placeholder, a terms / privacy-policy scope that
 * names no version of its document, a retention-periods scope without the period reviewed, and a
 * period on any other scope.
 */
export function planValidation(
  input: RecordValidationInput,
  registry: readonly RegistryEntry[],
): ValidationPlan {
  for (const key of input.versions) {
    const ref = parseDocumentVersionKey(key);
    if (ref === null) return { ok: false, reason: 'a --versions entry is not <type>:<version>' };
    const entry = registry.find((e) => e.type === ref.type && e.version === ref.version);
    if (entry === undefined) {
      return { ok: false, reason: `${key} is not a version in the legal registry` };
    }
    if (entry.draft) {
      return {
        ok: false,
        reason:
          `${key} is a draft placeholder ("RASCUNHO") and cannot be validated; publish the ` +
          'reviewed text as a new version first',
      };
    }
  }
  const type = documentTypeOfScope(input.scope);
  if (type !== null && !input.versions.some((key) => parseDocumentVersionKey(key)?.type === type)) {
    return { ok: false, reason: `scope ${input.scope} needs a --versions entry ${type}:<version>` };
  }
  if (input.scope === 'retention-periods' && input.retentionYears === undefined) {
    return { ok: false, reason: 'scope retention-periods needs --retention-years' };
  }
  if (input.scope !== 'retention-periods' && input.retentionYears !== undefined) {
    return { ok: false, reason: '--retention-years belongs to scope retention-periods' };
  }
  return {
    ok: true,
    scope: input.scope,
    validatorName: input.validator,
    documentVersions: input.versions.map((key) => {
      const ref = parseDocumentVersionKey(key) as NonNullable<
        ReturnType<typeof parseDocumentVersionKey>
      >;
      return documentVersionKey(ref);
    }),
    ...(input.reference !== undefined ? { reference: input.reference } : {}),
    ...(input.retentionYears !== undefined ? { retentionYears: input.retentionYears } : {}),
  };
}

export type RecordValidationOutcome =
  | { result: 'recorded'; scope: LegalValidationScope; documentVersions: readonly string[] }
  | { result: 'refused'; reason: string };

/** Exit code of the script: 0 when the validation was recorded, 1 otherwise. */
export function exitCodeOf(outcome: RecordValidationOutcome): 0 | 1 {
  return outcome.result === 'recorded' ? 0 : 1;
}

/** The one line the script prints: the outcome, never the validator's name or the reference (SC-15). */
export function summaryOf(outcome: RecordValidationOutcome): string {
  return outcome.result === 'recorded'
    ? `legal:record-validation: recorded ${outcome.scope}` +
        (outcome.documentVersions.length > 0 ? ` for ${outcome.documentVersions.join(', ')}` : '')
    : `legal:record-validation: refused, ${outcome.reason}; nothing was written`;
}
