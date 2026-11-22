// SPEC-010: the BFF paths and the answers of the privacy page, validated where they enter the
// page (AR-36 describes them on the API side). An answer that does not have the shape is a failed
// load, never a half-drawn page. SC-15: the personal data these answers carry is rendered, never
// logged, never put in a URL, never reported.
import { z } from 'zod';

export const PRIVACY_API = {
  acceptances: '/api/privacy/acceptances',
  whatsapp: '/api/privacy/whatsapp-consent',
  myData: '/api/privacy/my-data',
  exports: '/api/privacy/exports',
  /** The newest export of the account (the API lists newest first, AR-35). */
  latestExport: '/api/privacy/exports?page=1&pageSize=1',
  deleteAccount: '/api/privacy/delete-account',
  download: (id: string) => `/api/privacy/exports/${encodeURIComponent(id)}/download`,
} as const;

export const acceptanceSchema = z.object({
  documentType: z.enum(['terms', 'privacy']),
  version: z.string(),
  acceptedAt: z.string(),
  method: z.enum(['signup_email', 'signup_google', 'invitation', 'reacceptance']),
});
export type Acceptance = z.infer<typeof acceptanceSchema>;

export const acceptancesSchema = z.object({ items: z.array(acceptanceSchema) });

export const WHATSAPP_STATES = ['none', 'granted', 'withdrawn', 'declined'] as const;
export const whatsappConsentSchema = z.object({
  state: z.enum(WHATSAPP_STATES),
  at: z.string().nullable(),
  textVersion: z.string().nullable(),
});
export type WhatsappConsent = z.infer<typeof whatsappConsentSchema>;

export const EXPORT_STATUSES = ['queued', 'ready', 'failed', 'cancelled', 'expired'] as const;
export const dataExportSchema = z.object({
  id: z.string(),
  status: z.enum(EXPORT_STATUSES),
  requestedAt: z.string(),
  readyAt: z.string().optional(),
  expiresAt: z.string().optional(),
  errorCode: z.string().optional(),
});
export type DataExport = z.infer<typeof dataExportSchema>;

export const exportsPageSchema = z.object({ items: z.array(dataExportSchema) });

export const downloadLinkSchema = z.object({ url: z.string(), expiresInSeconds: z.number() });

/** The export file's own envelope: `{ schemaVersion, generatedAt, <section>... }`, sections are open. */
export const myDataSchema = z.record(z.string(), z.unknown());

/** One list section of "my data": how many records the account has, and whether the view was cut. */
export interface CountedSection {
  /** Records the account holds (the total when the view was cut). */
  total: number;
  /** Records shown. */
  shown: number;
  truncated: boolean;
}

export interface MyDataSummary {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** `password` and/or `google` */
  signInMethods: string[];
  favorites: CountedSection;
  savedFilters: CountedSection;
  reminders: CountedSection;
  notificationLogs: CountedSection;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

function counted(section: unknown): CountedSection {
  const record = asRecord(section);
  const shown = Array.isArray(record.items) ? record.items.length : 0;
  const totals = asRecord(record.totals);
  const reported = typeof totals.items === 'number' ? totals.items : null;
  const truncated = record.truncated === true;
  return {
    shown,
    total: truncated && reported !== null ? Math.max(reported, shown) : shown,
    truncated,
  };
}

/**
 * What "Seus dados" shows, from the document the API answers (the same sections as the export
 * file). The view is bounded: a section that was cut says `truncated` with its total, and the page
 * points to the export, which is complete (BR-010-08, BR-010-09).
 */
export function summarizeMyData(document: Record<string, unknown>): MyDataSummary {
  const account = asRecord(document.account);
  const signIn = asRecord(account.signIn);
  return {
    name: asText(account.name),
    email: asText(account.email),
    phone: asText(account.phone),
    signInMethods: Array.isArray(signIn.methods)
      ? signIn.methods.filter((method): method is string => typeof method === 'string')
      : [],
    favorites: counted(document.favorites),
    savedFilters: counted(document.savedFilters),
    reminders: counted(document.reminders),
    notificationLogs: counted(document.notificationLogs),
  };
}
