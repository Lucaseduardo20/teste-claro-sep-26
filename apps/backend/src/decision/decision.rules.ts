import { OutcomeType, RiskBand } from "@repo/contracts";

import { toBand } from "@/decision/risk-band";

/**
 * Os três motivos que levam um cancelamento à retenção humana.
 *
 * São textos livres na spec ("a avaliação olha a semântica, não a igualdade literal"),
 * mas precisam ser **distintos entre si**: quem atende o assinante do outro lado abre a
 * fila e tem que saber, sem abrir o caso, por que ele caiu ali — se foi indecisão do
 * modelo, se é uma assinatura cara que não se quer perder no automático, ou se o
 * scoring simplesmente não respondeu. Três causas diferentes, três encaminhamentos
 * diferentes, três frases diferentes.
 *
 * Os valores são os mesmos que `packages/contracts/src/scenarios.ts` usa como
 * referência de estilo. A igualdade é verificada em teste contra os 7 cenários, mas a
 * dependência é só de teste: a regra não importa os cenários.
 */
export const HUMAN_REASON = {
  /** Zona cinzenta: o risco caiu entre os dois limiares e a decisão não é automática. */
  GREY_ZONE: "grey zone",
  /** Alto risco numa assinatura de alto valor recorrente: cara demais para oferta automática. */
  HIGH_VALUE_AT_HIGH_RISK: "high recurring value at high risk",
  /** O Agente de Scoring estourou o `SCORING_TIMEOUT_MS`: decidir sem risco seria chutar. */
  SCORING_TIMEOUT: "scoring agent timeout",
} as const;

export type HumanReason = (typeof HUMAN_REASON)[keyof typeof HUMAN_REASON];

/** Faixa conservadora assumida quando o Agente de Scoring não responde a tempo. */
export const TIMEOUT_FALLBACK_BAND = RiskBand.GREY;

/**
 * Entrada da decisão.
 *
 * É uma união discriminada de propósito. No caminho com timeout **não existe** risco —
 * e não existir é diferente de ser zero. Modelando assim, o compilador impede que
 * alguém leia `input.risk` sem antes provar que o scoring respondeu, e some a
 * necessidade de um `risk?: number` que todo mundo teria que lembrar de checar.
 *
 * `isHighValue` também só aparece no caminho com risco: no timeout a regra é
 * conservadora independentemente do valor da assinatura, então oferecer o campo ali
 * seria sugerir uma influência que não existe.
 */
export type DecisionInput =
  { timedOut: true } | { timedOut: false; risk: number; isHighValue: boolean };

/** Parte da decisão que depende só da faixa (e, em `HIGH`, do valor da assinatura). */
export interface BandOutcome {
  outcomeType: OutcomeType;
  /** Presente **somente** quando o outcome é `HUMAN_RETENTION`. */
  humanReason?: HumanReason;
}

/**
 * Decisão final de um cancelamento.
 *
 * `risk` não faz parte da decisão: quem tinha o risco é o chamador, que já o conhece e
 * é quem vai persistir. Repeti-lo aqui só criaria duas fontes para o mesmo dado — e no
 * caminho de timeout não haveria valor nenhum para colocar.
 */
export interface Decision extends BandOutcome {
  band: RiskBand;
}

/**
 * Regra 2 — mapeia a faixa de risco no resultado do cancelamento.
 *
 * Caminho normal:
 * - `LOW`  → `CANCELLED` (segue o cancelamento, sem oferta)
 * - `GREY` → `HUMAN_RETENTION` (a decisão automática não é confiável nessa faixa)
 * - `HIGH` → `AUTOMATIC_OFFER` (oferta de retenção automática)
 *
 * **Interceptação de alto valor recorrente:** em `HIGH`, se a assinatura é de alto
 * valor, a oferta automática é interceptada e o caso vai para retenção humana. A
 * lógica é de negócio, não técnica: num assinante caro, o desconto padrão do
 * automático custa mais do que colocar um humano na conversa.
 *
 * A interceptação age **só** em `HIGH`. Em `LOW` e `GREY` o valor da assinatura é
 * irrelevante — um assinante Premium de baixo risco cancela direto como qualquer
 * outro, e um Premium em zona cinzenta vai para o humano pelo motivo `grey zone`, não
 * pelo preço do plano.
 *
 * `isHighValue` chega **pronto**, como booleano. Descobrir quais planos são de alto
 * valor exige ler os preços cadastrados no banco (`SELECT DISTINCT price_cents ...`) e
 * aplicar o percentil da spec — isso é responsabilidade de outra camada. Se esta função
 * fosse buscar esse dado, deixaria de ser pura e de ser testável sozinha.
 */
export function decideOutcome(band: RiskBand, isHighValue: boolean): BandOutcome {
  switch (band) {
    case RiskBand.LOW:
      return { outcomeType: OutcomeType.CANCELLED };

    case RiskBand.GREY:
      return { outcomeType: OutcomeType.HUMAN_RETENTION, humanReason: HUMAN_REASON.GREY_ZONE };

    case RiskBand.HIGH:
      return isHighValue
        ? {
            outcomeType: OutcomeType.HUMAN_RETENTION,
            humanReason: HUMAN_REASON.HIGH_VALUE_AT_HIGH_RISK,
          }
        : { outcomeType: OutcomeType.AUTOMATIC_OFFER };
  }
}

/**
 * Compõe as três regras e devolve a decisão completa de um cancelamento.
 *
 * Regra 3 — **fallback de timeout**: se o Agente de Scoring não respondeu dentro do
 * `SCORING_TIMEOUT_MS`, não há risco para classificar. A saída é conservadora — faixa
 * cinzenta e retenção humana — porque decidir no automático sem o risco seria chutar
 * nas duas direções: cancelar um assinante que daria para reter, ou dar desconto a
 * quem ia cancelar de qualquer jeito.
 *
 * Repare que o timeout **não** reaproveita `decideOutcome(GREY, ...)`. O resultado
 * seria o mesmo par band/outcome, mas o `humanReason` seria `grey zone` — e seria
 * mentira: não houve zona cinzenta nenhuma, houve uma falha de infraestrutura. Quem
 * atende precisa dessa diferença, e quem opera o sistema também (um pico de
 * `scoring agent timeout` é incidente; um pico de `grey zone` é o modelo).
 *
 * Função pura: sem HTTP, sem banco, sem relógio, sem estado.
 */
export function decide(input: DecisionInput): Decision {
  if (input.timedOut) {
    return {
      band: TIMEOUT_FALLBACK_BAND,
      outcomeType: OutcomeType.HUMAN_RETENTION,
      humanReason: HUMAN_REASON.SCORING_TIMEOUT,
    };
  }

  const band = toBand(input.risk);

  return { band, ...decideOutcome(band, input.isHighValue) };
}
