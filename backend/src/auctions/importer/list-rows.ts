// SPEC-004 BR-004-05, BR-004-06: the parser's normalized rows as the rows the apply takes. A row
// with no property number cannot be identified (BR-004-05) and is left out; the caller logs how many.
import { resolveOnCaixaSite } from '../../common/caixa-site.js';
import { modalityFromList } from '../domain/modality.js';
import type { ListRow } from '../domain/list-diff.js';
import type { NormalizedAuctionRow } from './parser.js';

export interface ListRows {
  rows: ListRow[];
  /** Rows with no property number. */
  withoutCode: number;
  /** Rows whose modality text is not one the product knows (kept: the property still counts as listed). */
  unknownModality: number;
  /** Rows whose link is not on Caixa's own site: stored with no link (SC-24, SC-19). */
  offSiteLinks: number;
}

export function toListRows(normalized: readonly NormalizedAuctionRow[]): ListRows {
  const rows: ListRow[] = [];
  let withoutCode = 0;
  let unknownModality = 0;
  let offSiteLinks = 0;
  for (const row of normalized) {
    if (!row.code) {
      withoutCode++;
      continue;
    }
    const modality = row.modality ? modalityFromList(row.modality) : null;
    if (modality === null) unknownModality++;
    // SC-24, SC-19: a link from Caixa's data is followed later, so only one on Caixa's own site is
    // kept; anything else (another host, credentials in the URL) is dropped here, at the door.
    const link = row.detailsUrl ? resolveOnCaixaSite(row.detailsUrl) : null;
    if (row.detailsUrl && link === null) offSiteLinks++;
    rows.push({
      code: row.code,
      title: row.title ?? null,
      address: {
        street: row.street,
        neighborhood: row.neighborhood,
        city: row.city,
        state: row.state,
      },
      appraisalPrice: row.appraisalPrice ?? null,
      minimumPrice: row.minimumPrice ?? null,
      modality,
      detailsUrl: link === null ? null : link.href,
      propertyType: row.propertyType,
    });
  }
  return { rows, withoutCode, unknownModality, offSiteLinks };
}
