// SPEC-004 BR-004-11, BR-004-15: what a property's detail page can say, as plain data. Pure
// (AR-05): the enums live here so `domain/` needs no schema import; schemas/auction.schema.ts
// re-exports them for the rest of the module (as it does for PhaseModality).
import type { Decimal } from '../../common/money/money.js';

export enum PaymentMethod {
  OWN_RESOURCES = 'OWN_RESOURCES', // Recursos próprios
  FGTS = 'FGTS', // Permite utilização de FGTS
  FINANCING = 'FINANCING', // Financiamento
}

export interface ExpenseRule {
  type: string; // e.g., 'Condomínio', 'Tributos'
  description: string;
}

/** BR-004-15: unknown is `null` wherever it is stored, never a third value. */
export type Occupancy = 'OCCUPIED' | 'UNOCCUPIED';

/** The minimum sale prices a page states, by round (reais, AR-17); null = the page gives none. */
export interface RoundPrices {
  /** "Valor mínimo de venda 1º Leilão". */
  first: Decimal | null;
  /** "Valor mínimo de venda 2º Leilão". */
  second: Decimal | null;
  /** "Valor mínimo de venda": the one round of the other modalities. */
  single: Decimal | null;
}

/**
 * What a recognised, available detail page says (SPEC-004 BR-004-11). Every field the page does
 * not state is null (or empty for the lists of things): UNKNOWN, never a default (BR-004-15), and
 * an unknown never replaces a known value.
 */
export interface DetailPage {
  /** The page's own text, kept entity-encoded (SC-19). */
  description: string | null;
  /** `Tipo de imóvel`, as Caixa writes it. */
  propertyType: string | null;
  /** `Situação`: Ocupado / Desocupado; anything else, or no line, is null. */
  occupancy: Occupancy | null;
  /** Round end dates, read as Brasília local time (BR-004-12), in the order the page lists them. */
  phaseDates: Date[];
  prices: RoundPrices;
  /** The "formas de pagamento" the page lists; null when it has no such section. */
  paymentMethods: PaymentMethod[] | null;
  /** The "regras para pagamento das despesas"; null when it has no such section. */
  expenseRules: ExpenseRule[] | null;
  /** Gallery photo links on Caixa's own site (SC-24), in page order, without repeats. */
  photoUrls: string[];
  matriculaUrl: string | null;
  editalUrl: string | null;
  /** `Edital publicado em`, read as Brasília local time. */
  editalPublishedAt: Date | null;
}
