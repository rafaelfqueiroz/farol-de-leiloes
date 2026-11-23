// SPEC-004 BR-004-06..09, BR-004-25, BR-004-26: the diff of one list row against the stored
// property. Expectations are written by hand from the rules, entry by entry.
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import {
  becameUnavailableEntry,
  diffListRow,
  type ListRow,
  type RowDiff,
  type RowUpdate,
  type StoredListState,
} from './list-diff.js';
import { PhaseModality } from './modality.js';

const d = (value: string) => new Decimal(value);

const ROW: ListRow = {
  code: '100',
  title: 'Casa, 60 m2',
  address: { street: 'RUA A', neighborhood: 'CENTRO', city: 'CAMPINAS', state: 'SP' },
  appraisalPrice: d('200000'),
  minimumPrice: d('150000'),
  modality: PhaseModality.SFI_AUCTION,
  detailsUrl: 'https://venda-imoveis.caixa.gov.br/x?hdnimovel=100',
  propertyType: 'Casa',
};

/** The stored property that equals ROW: applying ROW to it changes nothing. */
const STORED: StoredListState = {
  available: true,
  title: 'Casa, 60 m2',
  address: { street: 'RUA A', neighborhood: 'CENTRO', city: 'CAMPINAS', state: 'SP' },
  appraisalPrice: d('200000.00'),
  detailsUrl: 'https://venda-imoveis.caixa.gov.br/x?hdnimovel=100',
  propertyType: 'Casa',
  modality: PhaseModality.SFI_AUCTION,
  minimumPrice: d('150000.0'),
  phaseCount: 1,
  detailsCollected: false,
};

function update(diff: RowDiff): RowUpdate {
  if (diff.kind !== 'update') throw new Error(`expected an update, got ${diff.kind}`);
  return diff;
}

const types = (diff: RowDiff) =>
  diff.kind === 'insert' || diff.kind === 'update' ? diff.entries.map((e) => e.type) : [];

describe('a property seen for the first time (BR-004-06)', () => {
  it('is inserted with one NEW entry and nothing else', () => {
    const diff = diffListRow(null, ROW);

    expect(diff).toEqual({
      kind: 'insert',
      modality: PhaseModality.SFI_AUCTION,
      row: ROW,
      entries: [
        {
          propertyCode: '100',
          source: 'LIST',
          type: 'NEW',
          relevant: true,
          field: 'available',
          oldValue: null,
          newValue: true,
        },
      ],
    });
  });

  it('is skipped when its modality is unknown: it cannot be stored, and is not guessed', () => {
    expect(diffListRow(null, { ...ROW, modality: null })).toEqual({ kind: 'skip' });
  });
});

describe('a stored property the row does not change (BR-004-07)', () => {
  it('is unchanged: prices compare by value (150000.0 is 150000), so a re-apply finds nothing', () => {
    expect(diffListRow(STORED, ROW)).toEqual({ kind: 'unchanged' });
  });

  it('is unchanged when stored and listed text are both absent, and an unknown modality leaves it', () => {
    const stored = { ...STORED, title: null, address: {}, appraisalPrice: null, detailsUrl: null };
    const row = { ...ROW, title: null, address: {}, appraisalPrice: null, detailsUrl: null };
    expect(diffListRow(stored, row)).toEqual({ kind: 'unchanged' });
    expect(diffListRow(STORED, { ...ROW, modality: null, minimumPrice: d('1') })).toEqual({
      kind: 'unchanged',
    });
  });
});

describe('price (BR-004-25, BR-004-26)', () => {
  it('a lower list price is PRICE_DROPPED with the old and new amounts as decimal strings', () => {
    const diff = update(diffListRow(STORED, { ...ROW, minimumPrice: d('120000.5') }));

    expect(diff.entries).toEqual([
      {
        propertyCode: '100',
        source: 'LIST',
        type: 'PRICE_DROPPED',
        relevant: true,
        field: 'currentMinimumPrice',
        oldValue: '150000.00',
        newValue: '120000.50',
      },
    ]);
    expect(diff.changed).toBe(true);
    expect(diff.price).toEqual({ value: d('120000.5') });
    expect(diff.modalityChange).toBeUndefined();
  });

  it('a higher price is PRICE_RAISED, history only', () => {
    const diff = update(diffListRow(STORED, { ...ROW, minimumPrice: d('160000') }));
    expect(diff.entries.map((e) => [e.type, e.relevant])).toEqual([['PRICE_RAISED', false]]);
  });

  it('a price that appears or vanishes is OTHER_FIELD (not a drop, not a rise)', () => {
    const appears = update(
      diffListRow({ ...STORED, minimumPrice: null }, { ...ROW, minimumPrice: d('1') }),
    );
    expect(appears.entries.map((e) => [e.type, e.oldValue, e.newValue])).toEqual([
      ['OTHER_FIELD', null, '1.00'],
    ]);
    const vanishes = update(diffListRow(STORED, { ...ROW, minimumPrice: null }));
    expect(vanishes.entries.map((e) => [e.type, e.oldValue, e.newValue])).toEqual([
      ['OTHER_FIELD', '150000.00', null],
    ]);
    expect(vanishes.price).toEqual({ value: null });
  });
});

describe('modality (BR-004-26)', () => {
  it('a new modality is MODALITY_OR_ROUND_CHANGED and appends a phase with the list price', () => {
    const diff = update(diffListRow(STORED, { ...ROW, modality: PhaseModality.ONLINE_SALES }));

    expect(diff.entries).toEqual([
      {
        propertyCode: '100',
        source: 'LIST',
        type: 'MODALITY_OR_ROUND_CHANGED',
        relevant: true,
        field: 'modality',
        oldValue: 'SFI_AUCTION',
        newValue: 'ONLINE_SALES',
      },
    ]);
    expect(diff.modalityChange).toEqual({
      from: PhaseModality.SFI_AUCTION,
      to: PhaseModality.ONLINE_SALES,
      price: d('150000'),
    });
    expect(diff.price).toBeUndefined();
  });

  it('records the price change of the same row beside it', () => {
    const diff = update(
      diffListRow(STORED, {
        ...ROW,
        modality: PhaseModality.DIRECT_ONLINE_SALES,
        minimumPrice: d('100000'),
      }),
    );
    expect(diff.entries.map((e) => [e.type, e.field])).toEqual([
      ['MODALITY_OR_ROUND_CHANGED', 'modality'],
      ['PRICE_DROPPED', 'currentMinimumPrice'],
    ]);
  });

  it('a stored property with no modality gets its first phase, from null', () => {
    const diff = update(diffListRow({ ...STORED, modality: null }, ROW));
    expect(diff.entries.map((e) => [e.type, e.oldValue, e.newValue])).toEqual([
      ['MODALITY_OR_ROUND_CHANGED', null, 'SFI_AUCTION'],
    ]);
    expect(diff.modalityChange?.from).toBeNull();
  });
});

describe('a property back on the list (BR-004-09)', () => {
  it('is RETURNED, counted as changed, and carries its new modality entry too', () => {
    const diff = update(
      diffListRow(
        { ...STORED, available: false },
        { ...ROW, modality: PhaseModality.DIRECT_ONLINE_SALES },
      ),
    );

    expect(diff.returned).toBe(true);
    expect(diff.changed).toBe(true);
    expect(diff.entries.map((e) => [e.type, e.field, e.oldValue, e.newValue])).toEqual([
      ['RETURNED', 'available', false, true],
      ['MODALITY_OR_ROUND_CHANGED', 'modality', 'SFI_AUCTION', 'DIRECT_ONLINE_SALES'],
    ]);
  });

  it('is RETURNED alone when nothing else differs', () => {
    expect(types(diffListRow({ ...STORED, available: false }, ROW))).toEqual(['RETURNED']);
  });
});

describe('untracked list fields (BR-004-25)', () => {
  it('address, description, appraisal and link changes are applied and counted, with no entry', () => {
    const diff = update(
      diffListRow(STORED, {
        ...ROW,
        title: 'Casa, 70 m2',
        address: { ...ROW.address, street: 'RUA B' },
        appraisalPrice: d('210000'),
        detailsUrl: 'https://venda-imoveis.caixa.gov.br/y',
      }),
    );

    expect(diff.entries).toEqual([]);
    expect(diff.changed).toBe(true);
    expect(diff.fields).toEqual({
      title: 'Casa, 70 m2',
      address: { ...ROW.address, street: 'RUA B' },
      appraisalPrice: d('210000'),
      detailsUrl: 'https://venda-imoveis.caixa.gov.br/y',
    });
  });

  it('each address part counts: neighborhood, city, state', () => {
    for (const part of ['neighborhood', 'city', 'state'] as const) {
      const diff = diffListRow(STORED, { ...ROW, address: { ...ROW.address, [part]: 'OUTRO' } });
      expect(update(diff).fields.address).toBeDefined();
    }
  });

  it('an appraisal that appears or vanishes is a change', () => {
    expect(update(diffListRow({ ...STORED, appraisalPrice: null }, ROW)).fields).toEqual({
      appraisalPrice: d('200000'),
    });
    expect(update(diffListRow(STORED, { ...ROW, appraisalPrice: null })).fields).toEqual({
      appraisalPrice: null,
    });
  });
});

describe('the property type fallback (BR-004-11, BR-004-15)', () => {
  it('is applied silently from the list while the detail page was not collected', () => {
    const diff = update(diffListRow({ ...STORED, propertyType: null }, ROW));
    expect(diff.fields).toEqual({ propertyType: 'Casa' });
    expect(diff.changed).toBe(false);
    expect(diff.entries).toEqual([]);
  });

  it('never replaces the value the detail page collected', () => {
    expect(
      diffListRow({ ...STORED, propertyType: 'Residência', detailsCollected: true }, ROW),
    ).toEqual({ kind: 'unchanged' });
  });
});

describe('becameUnavailableEntry (BR-004-08)', () => {
  it('is the relevant entry of a property that left the list', () => {
    expect(becameUnavailableEntry('100')).toEqual({
      propertyCode: '100',
      source: 'LIST',
      type: 'BECAME_UNAVAILABLE',
      relevant: true,
      field: 'available',
      oldValue: true,
      newValue: false,
    });
  });
});
