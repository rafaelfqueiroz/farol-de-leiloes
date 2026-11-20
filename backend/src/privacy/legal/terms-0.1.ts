// SPEC-010 BR-010-07: placeholder outline of the terms of use, version 0.1. Topics only, never
// final legal prose: the text is the lawyer's to write (Q-21, BR-010-26). A published version is
// never edited (legal-registry.spec.ts pins its hash); the next text is a new file and a new version.
import { DRAFT_BANNER, type LegalDocumentSource } from './legal-document.js';

const CONTENT = `# Termos de Uso — esqueleto de tópicos (versão 0.1)

> **${DRAFT_BANNER}.** Este documento é apenas uma lista de tópicos que o texto final deverá cobrir. Não é o texto jurídico e não deve ser lido como tal.

## 1. Objeto e aceite

- Tópico: o que é o Farol dos Leilões (busca, análise e acompanhamento de imóveis de leilões da Caixa).
- Tópico: a conta só existe depois do aceite destes termos e da política de privacidade vigentes; quem não aceita não tem conta e nenhum dado pessoal fica guardado (BR-010-01).
- Tópico: toda nova versão deve ser aceita antes de usar as funcionalidades da conta; os direitos de acesso, exportação, correção e exclusão continuam disponíveis sem aceitar a nova versão (BR-010-05).

## 2. Papéis (BR-010-07)

- Tópico: papel da plataforma — ferramenta de informação e organização, sem atuar como parte da compra.
- Tópico: papel do assessor (escritório) — conduz a aquisição do investidor sob sua própria responsabilidade.
- Tópico: papel da inteligência artificial (SPEC-024) — apoio à análise, sem substituir o assessor nem o advogado; resultados são estimativas.

## 3. O que a plataforma não faz (BR-010-07)

- Tópico: a plataforma não dá lances em leilões.
- Tópico: a plataforma não realiza pagamentos de arremate, taxas ou tributos (SPEC-005).

## 4. Isolamento entre assessores (BR-010-07)

- Tópico: garantia de que os dados de clientes, perfis e jornadas de um escritório não são acessíveis a outro escritório.
- Tópico: assessores vinculados à plataforma não recebem acesso adicional aos dados de clientes de outros escritórios (BR-002-22; texto a confirmar).
- Tópico: o único acesso da operação da plataforma a dados de clientes é o acesso de suporte concedido pelo titular, limitado e registrado.

## 5. Conta e credenciais

- Tópico: o e-mail é a identidade de acesso da conta e não pode ser alterado.
- Tópico: responsabilidade do titular pela guarda da senha e pelo uso da conta.
- Tópico: encerramento da conta a pedido do titular.

## 6. Planos e assinaturas de escritórios

- Tópico: assinatura por escritório, cobrança pelo provedor de pagamentos, limite de jornadas ativas (SPEC-012).
- Tópico: cancelamento e reembolso do primeiro pagamento no prazo de 7 dias (a validar com o advogado).

## 7. Disposições gerais

- Tópico: alteração destes termos e forma de comunicação.
- Tópico: lei aplicável e foro [a definir].
`;

export const TERMS_0_1: LegalDocumentSource = {
  type: 'terms',
  version: '0.1',
  // Midnight 19/11/2026 in Brasília (UTC-3).
  effectiveAt: new Date('2026-11-19T03:00:00.000Z'),
  draft: true,
  title: 'Termos de Uso',
  banner: DRAFT_BANNER,
  content: CONTENT,
};
