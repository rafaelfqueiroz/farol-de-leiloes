// SPEC-004 BR-004-11: the sale modality. Pure (AR-05): the enum lives here so `domain/` needs no
// schema import; schemas/auction.schema.ts re-exports it for the rest of the module.

export enum PhaseModality {
  SFI_AUCTION = 'SFI_AUCTION',
  OPEN_BIDDING = 'OPEN_BIDDING',
  DIRECT_ONLINE_SALES = 'DIRECT_ONLINE_SALES',
  ONLINE_SALES = 'ONLINE_SALES',
}

/**
 * The modality of a list row's "Modalidade de venda" text; null when Caixa wrote one the product
 * does not know (unknown, BR-004-15: never guessed).
 *
 *   'Leilão SFI - Edital único' -> SFI_AUCTION;  'Venda Direta Online' -> DIRECT_ONLINE_SALES
 */
export function modalityFromList(text: string): PhaseModality | null {
  const normalized = text.toUpperCase();
  if (
    normalized.includes('SFI') ||
    normalized.includes('EDITAL ÚNICO') ||
    normalized.includes('EDITAL UNICO') ||
    normalized.includes('LEILÃO') ||
    normalized.includes('LEILAO')
  ) {
    return PhaseModality.SFI_AUCTION;
  }
  if (normalized.includes('LICITACAO') || normalized.includes('LICITAÇÃO')) {
    return PhaseModality.OPEN_BIDDING;
  }
  if (normalized.includes('VENDA DIRETA')) return PhaseModality.DIRECT_ONLINE_SALES;
  if (normalized.includes('VENDA ONLINE')) return PhaseModality.ONLINE_SALES;
  return null;
}
