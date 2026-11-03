// The auction shapes the BFF returns (list, detail, favourites). One definition for every screen.
// AR-17: money is a string of reais ("1234.56") over JSON, never a number; `null` means Caixa did
// not publish an amount (BR-003-19), which is shown as "Não informado", never R$ 0,00.

export interface AuctionAddress {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipcode?: string;
}

export interface ExpenseRule {
  type: string;
  description: string;
}

export interface AuctionPhase {
  modality: string;
  /** Reais, e.g. "380000.00"; null when the phase has no minimum bid. */
  minimumPrice: string | null;
  /** An ISO instant. */
  date?: string;
  /** ISO instants. */
  phaseDates?: string[];
  paymentMethods?: string[];
  expenseRules?: ExpenseRule[];
}

export interface Auction {
  code: string;
  title: string;
  address: AuctionAddress;
  /** Reais, e.g. "500000.00"; null when Caixa did not publish one. */
  appraisalPrice: string | null;
  phases: AuctionPhase[];
  currentPhase?: AuctionPhase;
  detailsUrl?: string;
  imageUrl?: string;
  updatedAt?: string;
}

/** `GET /auctions/:code`: the list shape plus the documents and status. */
export interface AuctionDetail extends Auction {
  matriculaUrl?: string;
  editalUrl?: string;
  description?: string;
  fulfilled?: boolean;
  available?: boolean;
  createdAt?: string;
}
