import { Test, type TestingModule } from "@nestjs/testing";
import {
  SCORING_TIMEOUT_MS,
  scenarios,
  type ScoringAgent,
  type ScoringInput,
  type ScoringResult,
} from "@repo/contracts";

import { MockScoringAgent, SIMULATED_LATENCY_MAX_MS } from "@/scoring/mock-scoring-agent";
import { ScoringModule } from "@/scoring/scoring.module";
import { ScoringService } from "@/scoring/scoring.service";
import { SCORING_AGENT } from "@/scoring/scoring.tokens";

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

function scenarioById(id: string): (typeof scenarios)[number] {
  const scenario = scenarios.find((candidate) => candidate.id === id);

  if (scenario === undefined) throw new Error(`Cenario "${id}" nao existe na spec`);

  return scenario;
}

/** Sobe o modulo real, opcionalmente trocando o agente por outra implementacao. */
async function createService(agent?: ScoringAgent): Promise<ScoringService> {
  const builder = Test.createTestingModule({ imports: [ScoringModule] });

  if (agent !== undefined) builder.overrideProvider(SCORING_AGENT).useValue(agent);

  const module: TestingModule = await builder.compile();

  return module.get(ScoringService);
}

describe("ScoringService: o deadline aplicado por fora do agente", () => {
  describe("caminho feliz", () => {
    it("devolve o risco do cenario e nao marca timeout", async () => {
      vi.useFakeTimers();
      const service = await createService();
      const scenario = scenarioById("scenario-high");

      const promise = service.score(inputFrom(scenario));
      await vi.advanceTimersByTimeAsync(SIMULATED_LATENCY_MAX_MS);
      const outcome = await promise;

      vi.useRealTimers();

      expect(outcome.timedOut).toBe(false);
      // O `if` estreita a uniao: `risk` so existe no ramo que respondeu a tempo.
      if (outcome.timedOut) throw new Error("esperava resposta dentro do prazo");
      expect(outcome.risk).toBe(scenario.expectedRisk);
    });
  });

  describe("timeout REAL (lento de proposito)", () => {
    /**
     * Este teste leva ~3s de relogio de parede, e isso e o ponto.
     *
     * Relogio real, MockScoringAgent real, deadline real. O mock agenda um setTimeout de
     * SCORING_TIMEOUT_MS + 500ms e de fato espera; o `Promise.race` do withDeadline corta
     * a corrida aos SCORING_TIMEOUT_MS. Nao ha flag nenhuma sendo lida: o caminho que a
     * producao percorreria e o caminho que este teste percorre.
     *
     * Com relogio falso o teste passaria em milissegundos — e provaria bem menos.
     */
    it(
      "corta o scenario-timeout no prazo e devolve timedOut sem risco",
      async () => {
        const service = await createService();
        const inicio = Date.now();

        const outcome = await service.score(inputFrom(scenarioById("scenario-timeout")));

        const decorrido = Date.now() - inicio;

        expect(outcome.timedOut).toBe(true);
        // Nao ha `risk` no resultado de timeout: a uniao discriminada nao tem onde por um.
        expect(outcome).not.toHaveProperty("risk");

        // Esperou o orcamento inteiro, e nao a latencia completa do agente (3500ms).
        expect(decorrido).toBeGreaterThanOrEqual(SCORING_TIMEOUT_MS - 50);
        expect(decorrido).toBeLessThan(SCORING_TIMEOUT_MS + 500);
      },
      SCORING_TIMEOUT_MS * 3,
    );
  });

  describe("latencyMs e a latencia simulada, nao o tempo de parede", () => {
    it("reporta o numero que o agente declarou, mesmo respondendo na hora", async () => {
      const LATENCIA_DECLARADA = 1234;
      const instantaneo: ScoringAgent = {
        score: (): Promise<ScoringResult> =>
          Promise.resolve({ risk: 0.42, latencyMs: LATENCIA_DECLARADA, timedOut: false }),
      };

      const service = await createService(instantaneo);
      const inicio = Date.now();
      const outcome = await service.score(inputFrom(scenarioById("scenario-low")));
      const parede = Date.now() - inicio;

      // O agente respondeu instantaneamente, mas reporta 1234ms. Se o service medisse o
      // tempo de parede, este numero seria ~0.
      expect(outcome.latencyMs).toBe(LATENCIA_DECLARADA);
      expect(parede).toBeLessThan(LATENCIA_DECLARADA);
    });

    it("no timeout reporta o orcamento gasto, nao uma medicao", async () => {
      const service = await createService(new MockScoringAgent());

      vi.useFakeTimers();
      const promise = service.score(inputFrom(scenarioById("scenario-timeout")));
      await vi.advanceTimersByTimeAsync(SCORING_TIMEOUT_MS);
      const outcome = await promise;
      vi.useRealTimers();

      expect(outcome.timedOut).toBe(true);
      expect(outcome.latencyMs).toBe(SCORING_TIMEOUT_MS);
    });
  });

  describe("substituibilidade pelo token (Ports & Adapters)", () => {
    it("aceita outra implementacao do port sem que o service saiba", async () => {
      const RISCO_DO_FAKE = 0.99;
      const fake: ScoringAgent = {
        score: (): Promise<ScoringResult> =>
          Promise.resolve({
            risk: RISCO_DO_FAKE,
            rationale: "fake agent",
            latencyMs: 1,
            timedOut: false,
          }),
      };

      const service = await createService(fake);
      const outcome = await service.score(inputFrom(scenarioById("scenario-low")));

      if (outcome.timedOut) throw new Error("o fake responde na hora");
      // O cenario declara 0.10; veio 0.99 do fake. Quem manda e o token, nao o mock.
      expect(outcome.risk).toBe(RISCO_DO_FAKE);
      expect(outcome.rationale).toBe("fake agent");
    });

    it("um agente que falha propaga o erro em vez de virar timeout", async () => {
      const quebrado: ScoringAgent = {
        score: (): Promise<ScoringResult> => Promise.reject(new Error("LLM fora do ar")),
      };

      const service = await createService(quebrado);

      await expect(service.score(inputFrom(scenarioById("scenario-low")))).rejects.toThrow(
        "LLM fora do ar",
      );
    });
  });
});
