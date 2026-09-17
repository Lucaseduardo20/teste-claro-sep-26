import {
  HIGH_RISK_THRESHOLD,
  LOW_RISK_THRESHOLD,
  SCORING_TIMEOUT_MS,
  scenarios,
  type ScoringAgent,
  type ScoringInput,
  type ScoringResult,
} from "@repo/contracts";

/**
 * Faixa de latência simulada para uma assinatura qualquer, em ms. É a janela que um
 * agente de IA real gastaria numa chamada de LLM — o suficiente para o fluxo ter um
 * estado de carregamento de verdade, e bem abaixo do `SCORING_TIMEOUT_MS`.
 */
const SIMULATED_LATENCY_MIN_MS = 200;
const SIMULATED_LATENCY_MAX_MS = 1500;

/**
 * Quanto o cenário de timeout passa do orçamento.
 *
 * Derivado do `SCORING_TIMEOUT_MS`, nunca escrito como número absoluto: se a spec
 * afrouxar o deadline, este cenário continua estourando. A margem existe para o teste
 * não depender de o agendador do Node acordar no milissegundo exato.
 */
const TIMEOUT_OVERSHOOT_MS = 500;

/**
 * Risco devolvido para uma assinatura que não é nenhum dos 7 cenários.
 *
 * É o **meio exato da zona cinzenta**, derivado dos dois limiares do contracts — não um
 * número escolhido a dedo. A escolha é deliberadamente conservadora e coerente com o
 * fallback de timeout: sem informação para decidir, um humano decide. Nunca cancela
 * sozinho nem oferece desconto sozinho.
 */
const UNKNOWN_SUBSCRIPTION_RISK = (LOW_RISK_THRESHOLD + HIGH_RISK_THRESHOLD) / 2;

/** Índice dos cenários por `subscriptionId`, montado uma vez no carregamento do módulo. */
const scenarioBySubscriptionId = new Map(
  scenarios.map((scenario) => [scenario.subscription.id, scenario]),
);

/** Espera de verdade. É isto que faz o deadline do wrapper ser exercido, e não fingido. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Latência simulada determinística para uma assinatura, dentro da faixa configurada.
 *
 * Deriva de um hash FNV-1a do `subscriptionId`: a mesma assinatura sempre "demora" o
 * mesmo tanto. Determinismo aqui não é capricho — é o que permite um teste afirmar o
 * valor exato de `latencyMs` em vez de checar um intervalo.
 */
function simulatedLatencyMs(subscriptionId: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < subscriptionId.length; i++) {
    hash ^= subscriptionId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  const span = SIMULATED_LATENCY_MAX_MS - SIMULATED_LATENCY_MIN_MS + 1;

  return SIMULATED_LATENCY_MIN_MS + (hash % span);
}

/**
 * Agente de Scoring determinístico — o **adapter** padrão do port `ScoringAgent`.
 *
 * Não existe modelo nenhum aqui: o risco vem dos cenários congelados de
 * `packages/contracts/src/scenarios.ts`, indexados por `subscriptionId`, exatamente
 * como o README do contracts descreve. Nenhum risco é recopiado à mão — mudar um
 * `expectedRisk` na spec muda o que este agente devolve, sem tocar neste arquivo.
 *
 * **Este agente não conhece deadline.** Ele só demora o que tem que demorar e responde.
 * Decidir que demorou demais é política de orquestração, e mora no `ScoringService`.
 * Por isso o cenário de timeout **espera de verdade** (`setTimeout` de
 * `SCORING_TIMEOUT_MS + 500ms`) em vez de devolver `timedOut: true` na hora: o caminho
 * que a produção percorreria é o que o teste exercita.
 *
 * A classe não tem `@Injectable()` nem importa nada do Nest de propósito — é um adapter
 * puro, instanciável em qualquer contexto. Quem o liga ao framework é o `ScoringModule`.
 */
export class MockScoringAgent implements ScoringAgent {
  async score(input: ScoringInput): Promise<ScoringResult> {
    const scenario = scenarioBySubscriptionId.get(input.subscription.id);
    const simulatesTimeout = scenario?.simulateTimeout === true;

    const latencyMs = simulatesTimeout
      ? SCORING_TIMEOUT_MS + TIMEOUT_OVERSHOOT_MS
      : simulatedLatencyMs(input.subscription.id);

    await delay(latencyMs);

    return {
      // `scenario-timeout` não declara `expectedRisk`, e cai no risco neutro. Na prática
      // este valor é inalcançável: o deadline do ScoringService corta a corrida antes.
      // Ele existe porque `ScoringResult.risk` é obrigatório no contrato — ver a nota
      // sobre essa tensão da spec no DECISIONS.md.
      risk: scenario?.expectedRisk ?? UNKNOWN_SUBSCRIPTION_RISK,
      rationale: rationaleFor(scenario?.id, simulatesTimeout),
      latencyMs,
      // Auto-relato: o agente sabe que estourou o próprio orçamento. Quem decide o que
      // fazer com isso continua sendo o wrapper — este campo não é o mecanismo.
      timedOut: latencyMs > SCORING_TIMEOUT_MS,
    };
  }
}

function rationaleFor(scenarioId: string | undefined, simulatesTimeout: boolean): string {
  if (simulatesTimeout) {
    return `deterministic mock: simulated latency over the ${SCORING_TIMEOUT_MS}ms budget`;
  }

  return scenarioId === undefined
    ? "deterministic mock: unknown subscription, neutral grey-zone risk"
    : `deterministic mock: risk declared by scenario "${scenarioId}"`;
}

export {
  SIMULATED_LATENCY_MAX_MS,
  SIMULATED_LATENCY_MIN_MS,
  TIMEOUT_OVERSHOOT_MS,
  UNKNOWN_SUBSCRIPTION_RISK,
};
