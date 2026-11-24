// SPEC-004 BR-004-29: what an alert says. The run's reason CODES in, a pt-BR catalogue text out:
// never an exception's message, never a row, never a person (SC-15). Pure (AR-05).

export type AlertOutcome = 'FAILED' | 'REJECTED_LIST' | 'NO_NEW_LIST' | 'COLLECTION_BLOCKED';

/** Whether a run owes the admins an email, and for which outcome (BR-004-29). */
export function alertOutcomeOf(run: {
  outcome: string;
  alertedAt: Date | null;
  collection: { blocked: boolean };
}): AlertOutcome | null {
  if (run.alertedAt !== null) return null;
  if (
    run.outcome === 'FAILED' ||
    run.outcome === 'REJECTED_LIST' ||
    run.outcome === 'NO_NEW_LIST'
  ) {
    return run.outcome;
  }
  // NO_UPDATE sends nothing (DL-004-12). An applied run alerts only when its collection was blocked.
  return run.outcome === 'SUCCESS' && run.collection.blocked ? 'COLLECTION_BLOCKED' : null;
}

export const OUTCOME_LABELS: Record<AlertOutcome, string> = {
  FAILED: 'Falhou',
  REJECTED_LIST: 'Lista rejeitada',
  NO_NEW_LIST: 'Sem lista nova em dia útil',
  COLLECTION_BLOCKED: 'Coleta de detalhes bloqueada',
};

/** The codes the catalogue has a sentence for. */
export type KnownReason =
  | 'LIST_BLOCKED'
  | 'LIST_UNREACHABLE'
  | 'NO_ATTEMPT'
  | 'APPLY_FAILED'
  | 'NO_NEW_LIST'
  | 'UNRECOGNISED_LAYOUT'
  | 'MISSING_COLUMNS'
  | 'NO_GENERATION_DATE'
  | 'GENERATION_DATE_IN_FUTURE'
  | 'EMPTY_LIST'
  | 'TOO_MANY_ROWS_WITHOUT_CODE'
  | 'UNREADABLE_PRICES'
  | 'TRUNCATED_LIST'
  | 'COLLECTION_BLOCKED';

/** The reason a code stands for, in pt-BR. Every sentence is fixed text. */
export const REASON_TEXTS: Readonly<Record<KnownReason, string>> = {
  LIST_BLOCKED:
    'O Caixa bloqueou o acesso à lista (proteção contra acesso automatizado). O sistema não tenta de novo no mesmo dia, para não insistir.',
  LIST_UNREACHABLE:
    'Não foi possível obter a lista do Caixa durante o dia: o site não respondeu, demorou demais ou devolveu um erro.',
  NO_ATTEMPT:
    'Nenhuma tentativa de importação foi feita neste dia útil até o horário limite: o sistema estava parado ou a importação estava desligada.',
  APPLY_FAILED:
    'Uma lista nova foi validada, mas não pôde ser aplicada ao catálogo. Nenhum imóvel foi marcado como indisponível.',
  NO_NEW_LIST:
    'O Caixa não publicou uma lista mais nova que a última aplicada até o horário limite de um dia útil.',
  UNRECOGNISED_LAYOUT: 'A lista baixada não tem o formato esperado (cabeçalho não reconhecido).',
  MISSING_COLUMNS: 'A lista baixada não tem todas as colunas esperadas.',
  NO_GENERATION_DATE: 'A lista baixada não informa a data de geração.',
  GENERATION_DATE_IN_FUTURE: 'A data de geração da lista é posterior a amanhã, o que indica erro.',
  EMPTY_LIST: 'A lista baixada não tem imóveis.',
  TOO_MANY_ROWS_WITHOUT_CODE:
    'Muitas linhas da lista não têm o número do imóvel: a coluna do número pode ter mudado.',
  UNREADABLE_PRICES:
    'Muitas linhas da lista têm preço ou avaliação em um formato que o sistema não lê.',
  TRUNCATED_LIST:
    'A lista baixada tem bem menos imóveis que a última aplicada: provavelmente está incompleta.',
  COLLECTION_BLOCKED:
    'A lista foi aplicada, mas o Caixa bloqueou a coleta das páginas de detalhes, que parou neste dia.',
};

/** The text of a code no catalogue entry knows (a code, never a message). */
export const UNKNOWN_REASON_TEXT =
  'Motivo fora do catálogo: veja os códigos abaixo e os registros da execução.';

/** Which code speaks for an outcome, best first: a decided run lists its codes in the order seen. */
const FAILED_PRIORITY: readonly KnownReason[] = [
  'LIST_BLOCKED',
  'APPLY_FAILED',
  'LIST_UNREACHABLE',
  'NO_ATTEMPT',
];
const REJECTED_CODES: readonly KnownReason[] = [
  'UNRECOGNISED_LAYOUT',
  'MISSING_COLUMNS',
  'NO_GENERATION_DATE',
  'GENERATION_DATE_IN_FUTURE',
  'EMPTY_LIST',
  'TOO_MANY_ROWS_WITHOUT_CODE',
  'UNREADABLE_PRICES',
  'TRUNCATED_LIST',
];

/** The code of `codes` that explains an alert of `outcome`; null when none is in the catalogue. */
export function primaryReason(outcome: AlertOutcome, codes: readonly string[]): KnownReason | null {
  if (outcome === 'COLLECTION_BLOCKED' || outcome === 'NO_NEW_LIST') return outcome;
  const wanted = outcome === 'FAILED' ? FAILED_PRIORITY : REJECTED_CODES;
  return wanted.find((code) => codes.includes(code)) ?? null;
}

export interface ImportAlertContent {
  /** `dd/mm/aaaa`, the run's Brasília day. */
  date: string;
  outcomeLabel: string;
  /** The catalogue sentence of the main reason. */
  reasonText: string;
  /** Every code the run recorded (stable codes only, SC-15). */
  codes: string[];
}

/** `2026-11-23` -> `23/11/2026`. */
export function formatBrasiliaDay(brasiliaDate: string): string {
  const [year, month, day] = brasiliaDate.split('-');
  return `${day}/${month}/${year}`;
}

/** The content of the alert of a run: its day, outcome and reason, chosen by code (BR-004-29). */
export function alertContent(
  outcome: AlertOutcome,
  brasiliaDate: string,
  failureReasons: readonly string[],
): ImportAlertContent {
  const code = primaryReason(outcome, failureReasons);
  return {
    date: formatBrasiliaDay(brasiliaDate),
    outcomeLabel: OUTCOME_LABELS[outcome],
    reasonText: code === null ? UNKNOWN_REASON_TEXT : REASON_TEXTS[code],
    codes: [...failureReasons],
  };
}
