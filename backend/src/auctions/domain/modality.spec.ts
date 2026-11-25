import { describe, expect, it } from 'vitest';
import { modalityFromList, PhaseModality } from './modality.js';

describe('modalityFromList (BR-004-11)', () => {
  it.each([
    ['Leilão SFI - Edital único', PhaseModality.SFI_AUCTION],
    ['Edital Único', PhaseModality.SFI_AUCTION],
    ['EDITAL UNICO', PhaseModality.SFI_AUCTION],
    ['Leilao', PhaseModality.SFI_AUCTION],
    ['Licitacao', PhaseModality.OPEN_BIDDING],
    ['Licitação Aberta', PhaseModality.OPEN_BIDDING],
    ['Venda Direta', PhaseModality.DIRECT_ONLINE_SALES],
    ['Venda Direta Online', PhaseModality.DIRECT_ONLINE_SALES],
    ['Venda Online', PhaseModality.ONLINE_SALES],
  ])('reads "%s" as %s', (text, expected) => {
    expect(modalityFromList(text)).toBe(expected);
  });

  it('answers null for a modality it does not know, never a guess (BR-004-15)', () => {
    expect(modalityFromList('Concorrência')).toBeNull();
    expect(modalityFromList('')).toBeNull();
  });
});
