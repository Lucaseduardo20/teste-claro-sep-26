import { OutcomeType, type CancellationOutcome } from "@repo/contracts";

/**
 * Tradução do resultado interno para o que o assinante lê.
 *
 * Duas regras guiam este arquivo:
 *
 * 1. **A tela fala a língua do assinante, não a do sistema.** `AUTOMATIC_OFFER` é um
 *    identificador de domínio; quem está cancelando lê "temos uma proposta para você".
 * 2. **O `humanReason` nunca chega à tela.** `grey zone`, `scoring agent timeout` e
 *    `high recurring value at high risk` são dados **operacionais** — servem para a fila de
 *    retenção humana, para o alerta de incidente e para a métrica de custo evitado (ver
 *    DECISIONS.md, seção 10). Mostrar "você caiu na zona cinzenta" ao assinante seria
 *    vazar a régua interna de decisão, e "o agente de scoring deu timeout" seria expor uma
 *    falha nossa como se fosse explicação dele. Os três caminhos que vão para o humano
 *    recebem **a mesma mensagem**, de propósito.
 */

export type OutcomeKind = OutcomeType | "PENDING";

export interface OutcomeCopy {
  /** Rótulo curto, para o `aria-label` da região e o `<title>` da página. */
  badge: string;
  title: string;
  description: string;
}

const COPY: Record<OutcomeKind, OutcomeCopy> = {
  [OutcomeType.CANCELLED]: {
    badge: "Cancelamento concluído",
    title: "Sua assinatura foi cancelada",
    description:
      "Tudo certo — não haverá novas cobranças. Você continua com acesso até o fim do ciclo " +
      "já pago, e pode voltar quando quiser.",
  },
  [OutcomeType.AUTOMATIC_OFFER]: {
    badge: "Temos uma proposta",
    title: "Antes de você ir, que tal continuar com desconto?",
    description:
      "Separamos uma oferta de retenção para a sua assinatura. Se preferir seguir com o " +
      "cancelamento, ele continua disponível.",
  },
  [OutcomeType.HUMAN_RETENTION]: {
    badge: "Atendimento humano",
    title: "Vamos te conectar com um especialista",
    description:
      "Seu caso merece uma conversa. Um especialista da nossa equipe vai entrar em contato " +
      "para entender melhor a sua situação e ver o que podemos fazer.",
  },
  PENDING: {
    badge: "Em análise",
    title: "Ainda estamos analisando sua solicitação",
    description:
      "Seu pedido foi registrado e está em processamento. Atualize a página em alguns " +
      "instantes para ver o resultado.",
  },
};

/**
 * Escolhe a mensagem a partir do outcome.
 *
 * `outcome` ausente é estado legítimo do domínio, não erro: o cancelamento foi gravado e a
 * decisão ainda não existe (ver DECISIONS.md, seção 1.2). A tela precisa saber lidar com
 * isso sem quebrar — daí o caminho `PENDING`.
 */
export function outcomeCopy(outcome: CancellationOutcome | undefined): OutcomeCopy {
  return COPY[outcome?.type ?? "PENDING"];
}
