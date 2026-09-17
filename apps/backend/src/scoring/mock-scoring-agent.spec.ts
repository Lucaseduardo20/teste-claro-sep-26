import { assertUUIDv7, SCORING_TIMEOUT_MS, scenarios, type ScoringInput } from "@repo/contracts";

import {
  MockScoringAgent,
  SIMULATED_LATENCY_MAX_MS,
  SIMULATED_LATENCY_MIN_MS,
  UNKNOWN_SUBSCRIPTION_RISK,
} from "@/scoring/mock-scoring-agent";

/**
 * Monta o `ScoringInput` a partir de um cenario do contracts. O agente so olha
 * `subscription.id`, mas o input completo e o que a spec define — e e o que o
 * orquestrador vai passar de verdade na Tarefa 04.
 */
function inputFrom(scenario: (typeof scenarios)[number]): ScoringInput {
  return {
    subscriber: scenario.subscriber,
    subscription: scenario.subscription,
    plan: scenario.plan,
    engagementEvents: scenario.engagementEvents,
    paymentEvents: scenario.paymentEvents,
    rawReason: scenario.rawReason,
  };
}

const comRisco = scenarios.filter((scenario) => scenario.expectedRisk !== undefined);
const doTimeout = scenarios.filter((scenario) => scenario.simulateTimeout === true);

describe("MockScoringAgent", () => {
  const agent = new MockScoringAgent();

  // Relogio falso na maior parte da suite: o mock espera de verdade, e sem isso cada
  // cenario custaria ate 1,5s de parede. O teste que precisa do relogio real e o do
  // deadline, no scoring.service.spec.ts.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Roda o agente e adianta o relogio falso o suficiente para ele responder. */
  async function score(input: ScoringInput) {
    const promise = agent.score(input);

    await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS + SIMULATED_LATENCY_MAX_MS);

    return promise;
  }

  describe("risco vem dos cenarios, nao de numeros recopiados", () => {
    it.each(comRisco)("$id devolve o expectedRisk declarado na spec", async (scenario) => {
      const result = await score(inputFrom(scenario));

      expect(result.risk).toBe(scenario.expectedRisk);
    });

    it("e deterministico: a mesma assinatura devolve sempre o mesmo resultado", async () => {
      const input = inputFrom(comRisco[0]!);

      const primeira = await score(input);
      const segunda = await score(input);

      expect(primeira).toEqual(segunda);
    });
  });

  describe("latencia simulada", () => {
    it.each(comRisco)("$id reporta latencia dentro da faixa configurada", async (scenario) => {
      const result = await score(inputFrom(scenario));

      expect(result.latencyMs).toBeGreaterThanOrEqual(SIMULATED_LATENCY_MIN_MS);
      expect(result.latencyMs).toBeLessThanOrEqual(SIMULATED_LATENCY_MAX_MS);
      expect(result.latencyMs).toBeLessThan(SCORING_TIMEOUT_MS);
    });

    it("nao reporta timeout quando fica dentro do orcamento", async () => {
      const result = await score(inputFrom(comRisco[0]!));

      expect(result.timedOut).toBe(false);
    });
  });

  describe("cenario de timeout: o mock espera de verdade", () => {
    it("existe exatamente um cenario de timeout na spec", () => {
      expect(doTimeout).toHaveLength(1);
    });

    it.each(doTimeout)("$id simula latencia acima do orcamento de scoring", async (scenario) => {
      const result = await score(inputFrom(scenario));

      expect(result.latencyMs).toBeGreaterThan(SCORING_TIMEOUT_MS);
      expect(result.timedOut).toBe(true);
    });

    it.each(doTimeout)("$id nao responde antes do deadline", async (scenario) => {
      const promise = agent.score(inputFrom(scenario));
      let respondeu = false;
      void promise.then(() => (respondeu = true));

      // Adianta ate exatamente o limite do orcamento e cede a vez as microtasks.
      await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS);

      expect(respondeu).toBe(false);

      await vi.advanceTimersByTimeAsync(SIMULATED_LATENCY_MAX_MS);
      await promise;

      expect(respondeu).toBe(true);
    });
  });

  describe("assinatura desconhecida", () => {
    const desconhecida: ScoringInput = {
      ...inputFrom(comRisco[0]!),
      // `assertUUIDv7` porque o contracts usa tipo branded: uma string crua nao e um
      // UUIDv7 valido para o compilador, e a validacao acontece de fato em runtime.
      subscription: {
        ...comRisco[0]!.subscription,
        id: assertUUIDv7("00000000-0000-7000-8000-000000000000"),
      },
    };

    it("cai no risco neutro, o meio exato da zona cinzenta", async () => {
      const result = await score(desconhecida);

      expect(result.risk).toBe(UNKNOWN_SUBSCRIPTION_RISK);
      expect(result.timedOut).toBe(false);
    });

    it("explica no rationale que a assinatura e desconhecida", async () => {
      const result = await score(desconhecida);

      expect(result.rationale).toContain("unknown subscription");
    });
  });
});
