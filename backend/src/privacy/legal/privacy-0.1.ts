// SPEC-010 BR-010-02, BR-010-06, BR-010-27: placeholder outline of the privacy policy, version 0.1.
// Topics only, never final legal prose (Q-21, BR-010-26). The purposes and categories follow the
// data inventory of SECURITY.md §9, which this text is written from; a PR that adds a field
// holding personal data updates that inventory and, in a new version, this text (SC-25). The
// field-to-purpose table is what the acceptance criterion "every field of the sign-up and profile
// screens maps to a purpose" is checked against (legal-registry.spec.ts). A published version is
// never edited: its hash is pinned.
import { DRAFT_BANNER, type LegalDocumentSource } from './legal-document.js';

const CONTENT = `# Política de Privacidade — esqueleto de tópicos (versão 0.1)

> **${DRAFT_BANNER}.** Este documento é apenas uma lista de tópicos que o texto final deverá cobrir. Não é o texto jurídico e não deve ser lido como tal. As bases legais abaixo são propostas.

## 1. Controlador e encarregado

- Tópico: identificação do controlador [a definir, depende dos termos da parceria].
- Tópico: encarregado pelo tratamento de dados (DPO) e canal de contato [a definir antes do lançamento].

## 2. Finalidades e categorias de dados (BR-010-02)

- Tópico: conta e acesso — nome, e-mail, telefone, senha (guardada apenas como hash) e, no acesso com Google, o identificador do Google. Base proposta: execução de contrato.
- Tópico: comprovação de aceite e de consentimentos — contas, versões aceitas, data e hora e forma do aceite. Base proposta: obrigação legal e prestação de contas.
- Tópico: funcionalidades usadas pela conta — favoritos, filtros salvos, alertas, lembretes e preferências de notificação. Base proposta: execução de contrato.
- Tópico: perfil de investidor — orçamento, objetivo e necessidade de financiamento, para o Radar e a pontuação de aderência (SPEC-013). Base proposta: execução de contrato.
- Tópico: gestão de aquisições — jornadas, custos, aportes e histórico (SPEC-016, SPEC-018). Base proposta: execução de contrato.
- Tópico: documentos e fotos de jornadas (SPEC-017), guardados por 5 anos após o encerramento da jornada (BR-010-18).
- Tópico: terceiros presentes em documentos (proprietários anteriores, ocupantes) — análise jurídica e processual (SPEC-015, SPEC-024); recurso desligado em produção até a validação jurídica (BR-010-25).
- Tópico: assinaturas de escritórios — identificadores do escritório, da conta compradora e do provedor de pagamentos; sem valores e sem dados de cartão (SPEC-012).
- Tópico: suporte — solicitações e mensagens enviadas ao suporte (SPEC-009).
- Tópico: registro de acesso administrativo — qual administrador leu qual registro, sob qual concessão de suporte e quando (BR-002-27).
- Tópico: sessões e segurança — sessões, vínculos de confirmação e recuperação de conta, contadores de tentativas de acesso por e-mail e origem.

## 3. Tabela campo → finalidade (BR-010-06)

Cada campo coletado no cadastro e no perfil tem uma finalidade declarada; um campo sem finalidade não é coletado.

| Campo | Onde é coletado | Finalidade | Base legal proposta |
| --- | --- | --- | --- |
| \`name\` | cadastro e perfil | Identificar o titular na conta e nas comunicações. | Execução de contrato — art. 7º, V |
| \`email\` | cadastro | Identidade de acesso da conta; envio de confirmação, recuperação e avisos da conta. | Execução de contrato — art. 7º, V |
| \`phone\` | perfil | Contato e envio de lembretes por SMS ou WhatsApp quando o titular escolhe esses canais. | Execução de contrato — art. 7º, V; WhatsApp: consentimento específico (seção 6) |
| \`password\` | cadastro | Autenticar o titular; guardada somente como hash, nunca exibida. | Execução de contrato — art. 7º, V |

## 4. Compartilhamento e operadores

- Tópico: operadores — pagamentos (Stripe), inteligência artificial (OpenAI), arquivos (Cloudflare R2), acesso com Google, monitoramento de erros (Sentry), e-mail, SMS e WhatsApp, hospedagem (Hostinger) e banco de dados (MongoDB Atlas).
- Tópico: transferência internacional de dados para operadores fora do Brasil (LGPD art. 33).
- Tópico: o que cada operador recebe e o que nunca recebe (por exemplo, a plataforma não recebe dados de cartão).

## 5. Retenção

- Tópico: dados da conta — até a exclusão da conta e até 30 dias depois (BR-010-15).
- Tópico: documentos de jornadas encerradas — 5 anos após o encerramento (BR-010-18); a exclusão da conta não encurta esse prazo (BR-010-20).
- Tópico: registros de aceite, cobrança e acesso administrativo — prazos definidos com o advogado (Q-21); até lá não são apagados.

## 6. Consentimento para WhatsApp (BR-010-27)

- Tópico: consentimento próprio, opcional, separado dos termos e não marcado por padrão.
- Tópico: recusar não impede criar a conta; o titular pode retirar o consentimento a qualquer momento e, desde a retirada, nenhuma mensagem é enviada.
- Tópico: consentir não liga nenhuma mensagem por si só; continuam necessários a escolha por evento e o telefone verificado.

## 7. Direitos do titular (BR-010-08 a BR-010-17)

- Tópico: acesso aos dados e exportação completa em formato estruturado, em até 15 dias.
- Tópico: correção de nome e telefone pelo próprio titular; e-mail imutável; demais correções por solicitação ao suporte.
- Tópico: exclusão da conta mediante nova autenticação — a conta é encerrada de imediato e os dados pessoais são apagados ou anonimizados em até 30 dias, salvo o que a lei obriga a manter.
- Tópico: nomes de pessoas removidas aparecem como "usuário removido", com pseudônimo estável por jornada (BR-010-28).

## 8. Cookies

- Tópico: o produto não usa cookies não essenciais; adicionar algum exige rever este texto.

## 9. Versões

- Tópico: todas as versões publicadas permanecem disponíveis com a data de vigência, e o titular vê quais aceitou e quando (BR-010-04).
`;

export const PRIVACY_0_1: LegalDocumentSource = {
  type: 'privacy',
  version: '0.1',
  // Midnight 19/11/2026 in Brasília (UTC-3).
  effectiveAt: new Date('2026-11-19T03:00:00.000Z'),
  draft: true,
  title: 'Política de Privacidade',
  banner: DRAFT_BANNER,
  content: CONTENT,
};
