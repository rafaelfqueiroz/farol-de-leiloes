// SPEC-003 BR-003-08: the catalog part of the reference workload — a deterministic, synthetic
// catalog the size of the full Caixa catalog for all states. Pure: no database, no clock and no
// randomness that is not seeded, so the same options always give the same documents (TS-06).
//
// Everything here is generated and obviously fake (TS-27): no real address, no real code. City
// names are public place names; streets and neighbourhoods are numbered placeholders.
import { TZDate } from '@date-fns/tz';
import { toStoredPhase } from '../../src/auctions/auction.mapper.js';
import type { Phase } from '../../src/auctions/interfaces/auction.interface.js';
import {
  type AuctionEntity,
  PaymentMethod,
  PhaseModality,
} from '../../src/auctions/schemas/auction.schema.js';
import {
  BRASILIA_TIME_ZONE,
  brasiliaWallClockToInstant,
} from '../../src/common/clock/brasilia-time.js';
import { toDecimal128 } from '../../src/common/money/decimal128.js';
import { Decimal } from '../../src/common/money/money.js';

/**
 * The order of magnitude of the full Caixa catalog for all states as imported (BR-003-08). The
 * live list moves day to day; the performance run (BR-003-06..10) states the count it ran with.
 */
export const FULL_CATALOG_SIZE = 35_000;

/**
 * The fixed auctions every seeded catalog carries, whatever its size, so E2E specs can open a
 * known property page. Their codes start with 9, which no generated code does.
 *
 * `BRASILIA_TEN_AM` is published as "26/01/2026 - 10h00", Brasília time (BR-003-25): the
 * property page must show `26/01/2026 10:00` whatever the browser's zone (BR-003-23).
 */
export const FIXTURE_AUCTIONS = {
  BRASILIA_TEN_AM: '9000000000001',
} as const;

/** A seeded auction as written to the `auctions` collection (the importer's shape). */
export type SeededAuction = Pick<
  AuctionEntity,
  | 'code'
  | 'title'
  | 'address'
  | 'appraisalPrice'
  | 'phases'
  | 'currentPhase'
  | 'detailsUrl'
  | 'description'
  | 'fulfilled'
  | 'available'
  | 'updatedAt'
>;

export interface CatalogOptions {
  /** How many generated auctions, besides the fixtures. */
  size: number;
  /** PRNG seed; the same seed and reference date give the same catalog. */
  seed: number;
  /**
   * The instant phase dates are spread around, read as a Brasília day. Most dates fall after it,
   * so the catalog reads as current to the search (an active auction has a future date or is an
   * online sale).
   */
  referenceDate: Date;
}

/**
 * Share of the catalog per state, in parts per thousand. Shaped like the Caixa list (heaviest in
 * RJ, SP, GO, MG, BA, RS and PE, a long tail elsewhere); every one of the 27 units has listings,
 * so the state and city filters are measured on the whole country (BR-003-08).
 */
export const STATE_WEIGHTS: Readonly<Record<string, number>> = {
  RJ: 150,
  SP: 140,
  GO: 85,
  MG: 80,
  BA: 70,
  RS: 60,
  PE: 55,
  PR: 45,
  CE: 40,
  SC: 30,
  PA: 30,
  RN: 25,
  MA: 22,
  PB: 22,
  MT: 20,
  MS: 18,
  ES: 18,
  AL: 15,
  DF: 15,
  PI: 12,
  SE: 10,
  AM: 10,
  TO: 8,
  RO: 6,
  AP: 5,
  AC: 5,
  RR: 4,
};

/** A few public city names per state; the first is the capital and carries the most listings. */
const CITIES: Readonly<Record<string, readonly string[]>> = {
  AC: ['Rio Branco', 'Cruzeiro do Sul'],
  AL: ['Maceió', 'Arapiraca', 'Rio Largo'],
  AM: ['Manaus', 'Parintins'],
  AP: ['Macapá', 'Santana'],
  BA: ['Salvador', 'Feira de Santana', 'Camaçari', 'Lauro de Freitas', 'Vitória da Conquista'],
  CE: ['Fortaleza', 'Caucaia', 'Maracanaú', 'Juazeiro do Norte'],
  DF: ['Brasília'],
  ES: ['Vitória', 'Vila Velha', 'Serra', 'Cariacica'],
  GO: ['Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Valparaíso de Goiás', 'Luziânia'],
  MA: ['São Luís', 'Imperatriz', 'São José de Ribamar'],
  MG: ['Belo Horizonte', 'Contagem', 'Uberlândia', 'Juiz de Fora', 'Betim', 'Montes Claros'],
  MS: ['Campo Grande', 'Dourados', 'Três Lagoas'],
  MT: ['Cuiabá', 'Várzea Grande', 'Rondonópolis', 'Sinop'],
  PA: ['Belém', 'Ananindeua', 'Marabá', 'Santarém'],
  PB: ['João Pessoa', 'Campina Grande', 'Santa Rita'],
  PE: ['Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Paulista', 'Caruaru'],
  PI: ['Teresina', 'Parnaíba'],
  PR: ['Curitiba', 'Londrina', 'Maringá', 'Cascavel', 'Ponta Grossa'],
  RJ: ['Rio de Janeiro', 'São Gonçalo', 'Duque de Caxias', 'Nova Iguaçu', 'Niterói'],
  RN: ['Natal', 'Parnamirim', 'Mossoró'],
  RO: ['Porto Velho', 'Ji-Paraná'],
  RR: ['Boa Vista'],
  RS: ['Porto Alegre', 'Caxias do Sul', 'Canoas', 'Pelotas', 'Santa Maria'],
  SC: ['Florianópolis', 'Joinville', 'Blumenau', 'São José'],
  SE: ['Aracaju', 'Nossa Senhora do Socorro'],
  SP: ['São Paulo', 'Guarulhos', 'Campinas', 'São Bernardo do Campo', 'Santos', 'Sorocaba'],
  TO: ['Palmas', 'Araguaína'],
};

/** Neighbourhoods per city: enough for the neighbourhood filter to have a real list. */
const NEIGHBOURHOODS_PER_CITY = 12;

/**
 * Modalities in roughly the shares the Caixa list shows: mostly online and direct sales, fewer
 * open biddings and SFI auctions. Parts per hundred.
 */
const MODALITY_WEIGHTS: ReadonlyArray<readonly [PhaseModality, number]> = [
  [PhaseModality.ONLINE_SALES, 40],
  [PhaseModality.DIRECT_ONLINE_SALES, 30],
  [PhaseModality.OPEN_BIDDING, 18],
  [PhaseModality.SFI_AUCTION, 12],
];

const KINDS = ['Casa', 'Apartamento', 'Terreno', 'Loja', 'Sobrado'] as const;

/** mulberry32: a small, fast, seeded PRNG. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(random: () => number, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  // Floating-point remainder: the last entry.
  const last = entries[entries.length - 1];
  if (!last) throw new Error('pickWeighted: no entries');
  return last[0];
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('pick: no values');
  return value;
}

const STATE_ENTRIES = Object.entries(STATE_WEIGHTS);

/** BR-003-26: the Brasília calendar day of an instant, read through the IANA zone (BR-003-28). */
function brasiliaDayOf(instant: Date): { year: number; month: number; day: number } {
  const local = new TZDate(instant.getTime(), BRASILIA_TIME_ZONE);
  return { year: local.getFullYear(), month: local.getMonth() + 1, day: local.getDate() };
}

function phaseDatesFor(
  random: () => number,
  modality: PhaseModality,
  reference: Date,
): Date[] | undefined {
  // Online sales have no fixed date; the search counts them as active anyway.
  if (modality === PhaseModality.ONLINE_SALES) return undefined;
  const { year, month, day } = brasiliaDayOf(reference);
  // 1–60 days ahead; one in ten in the recent past, as the list carries until it refreshes. A
  // day past the month's end rolls over, as Date's own field arithmetic does.
  const offset = random() < 0.1 ? -1 - Math.floor(random() * 10) : 1 + Math.floor(random() * 60);
  const hours = pick(random, [9, 10, 11, 14, 15]);
  const first = brasiliaWallClockToInstant({ year, month, day: day + offset, hours });
  if (modality !== PhaseModality.SFI_AUCTION) return [first];
  // An SFI auction has a first and a second round, 15 days apart.
  const second = brasiliaWallClockToInstant({ year, month, day: day + offset + 15, hours });
  return [first, second];
}

function paymentMethodsFor(random: () => number): PaymentMethod[] {
  const methods = [PaymentMethod.OWN_RESOURCES];
  if (random() < 0.45) methods.push(PaymentMethod.FGTS);
  if (random() < 0.55) methods.push(PaymentMethod.FINANCING);
  return methods;
}

/** A 13-digit code like Caixa's, starting 1–8 (9 is reserved for the fixtures). */
export function generatedCode(index: number): string {
  return `${1 + (index % 8)}${String(index).padStart(12, '0')}`;
}

function generatedAuction(index: number, random: () => number, reference: Date): SeededAuction {
  const state = pickWeighted(random, STATE_ENTRIES);
  const cities = CITIES[state] ?? [state];
  // The capital carries about half of a state's listings.
  const city = random() < 0.5 ? (cities[0] ?? state) : pick(random, cities);
  const neighborhood = `Bairro ${1 + Math.floor(random() * NEIGHBOURHOODS_PER_CITY)}`;
  const kind = pick(random, KINDS);
  const modality = pickWeighted(random, MODALITY_WEIGHTS);

  // AR-17: prices are built from whole reais and a whole-percent discount, as Decimals. E.g. an
  // appraisal of 180 000 at 63% gives a minimum price of 113 400.00.
  const appraisalReais = 60_000 + Math.floor(random() ** 2 * 1_440_000); // skewed low, as the list is
  const discountPercent = 40 + Math.floor(random() * 50); // 40–89% of the appraisal
  const appraisalPrice = new Decimal(appraisalReais).toDecimalPlaces(2);
  const minimumPrice = appraisalPrice.mul(discountPercent).div(100).toDecimalPlaces(2);

  const phase: Phase = {
    modality,
    minimumPrice,
    phaseDates: phaseDatesFor(random, modality, reference),
    paymentMethods: paymentMethodsFor(random),
  };
  const stored = toStoredPhase(phase);

  return {
    code: generatedCode(index),
    title: `${kind} em ${neighborhood}, ${city}/${state}`,
    address: {
      street: `Rua Exemplo ${1 + (index % 500)}, ${1 + Math.floor(random() * 2000)}`,
      neighborhood,
      city,
      state,
      zipcode: `${10_000 + Math.floor(random() * 89_999)}-000`,
    },
    appraisalPrice: toDecimal128(appraisalPrice),
    phases: [stored],
    currentPhase: stored,
    detailsUrl: null,
    description: `${kind} gerado para o catálogo de referência (SPEC-003 BR-003-08).`,
    fulfilled: true,
    available: true,
    updatedAt: reference,
  };
}

/** The fixed auctions of FIXTURE_AUCTIONS. */
export function fixtureAuctions(reference: Date): SeededAuction[] {
  // "26/01/2026 - 10h00" as Caixa publishes it: 13:00 UTC (BR-003-25).
  const tenAm = brasiliaWallClockToInstant({ year: 2026, month: 1, day: 26, hours: 10 });
  const phase = toStoredPhase({
    modality: PhaseModality.SFI_AUCTION,
    minimumPrice: new Decimal('180000.00'),
    phaseDates: [tenAm],
    paymentMethods: [PaymentMethod.OWN_RESOURCES, PaymentMethod.FINANCING],
  });
  return [
    {
      code: FIXTURE_AUCTIONS.BRASILIA_TEN_AM,
      title: 'Casa de referência E2E em Bairro 1, Rio de Janeiro/RJ',
      address: {
        street: 'Rua Exemplo 1, 100',
        neighborhood: 'Bairro 1',
        city: 'Rio de Janeiro',
        state: 'RJ',
        zipcode: '20000-000',
      },
      appraisalPrice: toDecimal128(new Decimal('250000.00')),
      phases: [phase],
      currentPhase: phase,
      detailsUrl: null,
      description: 'Imóvel fixo do catálogo de referência, publicado para 26/01/2026 - 10h00.',
      fulfilled: true,
      available: true,
      updatedAt: reference,
    },
  ];
}

/**
 * The whole catalog: the fixtures, then `size` generated auctions. Lazy, so a full-size seed
 * never holds every document in memory at once.
 */
export function* referenceCatalog(options: CatalogOptions): Generator<SeededAuction> {
  if (!Number.isInteger(options.size) || options.size < 0) {
    throw new Error('referenceCatalog: size must be a non-negative integer');
  }
  yield* fixtureAuctions(options.referenceDate);
  const random = seededRandom(options.seed);
  for (let index = 1; index <= options.size; index += 1) {
    yield generatedAuction(index, random, options.referenceDate);
  }
}
