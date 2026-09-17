import { HIGH_VALUE_PERCENTILE, plans, scenarios, type Scenario } from "@repo/contracts";

import { decide, type DecisionInput } from "@/decision/decision.rules";

/**
 * Validacao cruzada da camada de decisao contra os 7 cenarios congelados do contracts.
 *
 * Os testes acima provam que cada regra faz o que eu disse que faz. Este prova que o
 * conjunto bate com a spec: para cada cenario, a decisao tem que reproduzir
 * exatamente o `expectedBand`, o `expectedOutcome.type` e o `expectedOutcome.humanReason`
 * declarados em `packages/contracts/src/scenarios.ts`. Se um unico cenario divergir, a
 * regra esta errada — nao o cenario.
 */

/**
 * Corte de alto valor recorrente, pela formula fixada no README do contracts: ordena os
 * `priceCents` DISTINTOS em ordem crescente, `k = ceil(HIGH_VALUE_PERCENTILE * n)`, e os
 * `k` maiores precos sao de alto valor.
 *
 * ATENCAO: isto e andaime de teste, nao implementacao. A versao de producao deriva os
 * precos do banco (`SELECT DISTINCT price_cents FROM plans`) e e responsabilidade de
 * outra camada, numa tarefa futura. Aqui ele existe so para traduzir "qual plano" em
 * "isHighValue" e alimentar a regra pura — que e justamente o ponto: a regra nao sabe
 * de onde esse booleano veio.
 */
function highValuePriceCents(): ReadonlySet<number> {
  const distinct = [...new Set(plans.map((plan) => plan.priceCents))].sort((a, b) => a - b);
  const k = Math.ceil(HIGH_VALUE_PERCENTILE * distinct.length);

  return new Set(distinct.slice(distinct.length - k));
}

/** Traduz um cenario do contracts na entrada da regra pura. */
function toDecisionInput(scenario: Scenario, highValue: ReadonlySet<number>): DecisionInput {
  if (scenario.simulateTimeout === true) return { timedOut: true };

  const { expectedRisk } = scenario;

  if (expectedRisk === undefined) {
    throw new Error(`Cenario "${scenario.id}" nao declara expectedRisk nem simulateTimeout`);
  }

  return {
    timedOut: false,
    risk: expectedRisk,
    isHighValue: highValue.has(scenario.plan.priceCents),
  };
}

describe("Validacao cruzada com os cenarios do contracts", () => {
  const highValue = highValuePriceCents();

  it("cobre os 7 cenarios da spec", () => {
    expect(scenarios).toHaveLength(7);
  });

  it("o corte de alto valor com os planos do seed isola apenas o Premium", () => {
    // 3 precos distintos -> k = ceil(0.2 * 3) = ceil(0.6) = 1 -> so o mais caro.
    expect([...highValue]).toEqual([19900]);
  });

  it.each(scenarios)("$id: $description", (scenario) => {
    const decision = decide(toDecisionInput(scenario, highValue));

    expect(decision.band).toBe(scenario.expectedBand);
    expect(decision.outcomeType).toBe(scenario.expectedOutcome.type);
    expect(decision.humanReason).toBe(scenario.expectedOutcome.humanReason);
  });
});
