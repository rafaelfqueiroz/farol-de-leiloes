// SPEC-004 part 4: helpers of the detail-collection specs. A list of the day, the page of a
// property, and "run the day" through the REAL orchestrator with the REAL pass, over fakes (Caixa,
// clock, mail, R2) and a real MongoDB. Everything is invented (TS-27).
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import { CAIXA_ORIGIN } from '../../src/common/caixa-site.js';
import type { RoundClockService } from '../../src/auctions/enrichment/round-clock.service.js';
import type { ImportHarness } from './import-harness.js';

export const HH = (hours: number, minutes = 0) => hours * 60 + minutes;

export const MODALITY = {
  sfi: 'Leilão SFI - Edital único',
  bidding: 'Licitação Aberta',
  direct: 'Venda Direta Online',
} as const;

/** The detail page link of a property on a list (what the list apply stores as `detailsUrl`). */
export const pageUrl = (code: string) =>
  `${CAIXA_ORIGIN}/sistema/detalhe-imovel.asp?hdnimovel=${code}`;

/** `2026-11-23` -> `23/11/2026`. */
const ddmmyyyy = (day: string) => day.split('-').reverse().join('/');

export interface ListedProperty {
  code: string;
  modality?: string;
  price?: string;
}

/** A Caixa list generated on `day` with the given properties (the shape of the real CSV). */
export function csvList(day: string, rows: readonly ListedProperty[]): string {
  return (
    ` Lista de Imóveis da Caixa;;Data de geração:;${ddmmyyyy(day)};;;;;;;\n` +
    ' N° do imóvel;UF;Cidade;Bairro;Endereço;Preço;Valor de avaliação;Desconto;Descrição;Modalidade de venda;Link de acesso\n\n' +
    rows
      .map(
        ({ code, modality = MODALITY.bidding, price = '100.000,00' }) =>
          ` ${code} ;SP ;CAMPINAS ;CENTRO ; RUA A, N. 1 ;${price};200.000,00;50.00;Casa, 60 m2;${modality};${pageUrl(code)}\n`,
      )
      .join('')
  );
}

/** `n` properties numbered 0001... with the same modality. */
export const properties = (n: number, modality: string = MODALITY.bidding): ListedProperty[] =>
  Array.from({ length: n }, (_, index) => ({ code: String(index + 1).padStart(4, '0'), modality }));

export interface DayOptions {
  /** The settings of the pass and of the import (raw environment values). */
  env?: Record<string, string>;
  minutes?: number;
  /** The round clock the completion step runs (a spec can make its writes fail). */
  roundClock?: RoundClockService;
}

/**
 * One tick of the real orchestrator on `day`, with the real pass: serves `csv` as the list, sets
 * the clock, and runs the tick through fake time (`drive`), so the pauses of the collection cost
 * nothing. Answers the day's Import Run.
 */
export async function runDay(h: ImportHarness, day: string, csv: string, options: DayOptions = {}) {
  const env = options.env ?? {};
  h.caixa.serveList(csv);
  h.clock.set(brasiliaInstant(day, options.minutes ?? HH(6)));
  const orchestrator = h.orchestrator(env, {
    enrichment: h.realPass(env),
    ...(options.roundClock === undefined ? {} : { roundClock: options.roundClock }),
  });
  await h.sleeper.drive(orchestrator.tick());
  return h.kit.runs.findByDate(day);
}

/** The detail pages asked for, by property number, in order. */
export function pagesRequested(h: ImportHarness): string[] {
  return h.caixa.requests
    .filter((request) => request.kind === 'detail')
    .map((request) => new URL(request.url ?? '').searchParams.get('hdnimovel') ?? '');
}

/** The files asked for (photos and documents), by their path on Caixa's site. */
export function filesRequested(h: ImportHarness): string[] {
  return h.caixa.requests
    .filter((request) => request.kind === 'file')
    .map((request) => new URL(request.url ?? '').pathname);
}

export async function stored(h: ImportHarness, code: string) {
  return h.kit.auctionModel.findOne({ code }).lean().exec();
}

export async function entriesOf(
  h: ImportHarness,
  code: string,
  source?: 'LIST' | 'DETAILS' | 'CLOCK',
) {
  return h.kit.changeModel
    .find({ propertyCode: code, ...(source === undefined ? {} : { source }) })
    .sort({ createdAt: 1, field: 1, type: 1 })
    .lean()
    .exec();
}
