import { OutcomeType, RiskBand } from "@repo/contracts";

import { decide, decideOutcome, HUMAN_REASON, type DecisionInput } from "@/decision/decision.rules";

describe("Regra 2 - decideOutcome: faixa para resultado", () => {
  describe("caminho normal (assinatura que nao e de alto valor)", () => {
    it("LOW prossegue com o cancelamento, sem oferta e sem motivo humano", () => {
      const outcome = decideOutcome(RiskBand.LOW, false);

      expect(outcome.outcomeType).toBe(OutcomeType.CANCELLED);
      expect(outcome.humanReason).toBeUndefined();
    });

    it("GREY encaminha para retencao humana com o motivo de zona cinzenta", () => {
      const outcome = decideOutcome(RiskBand.GREY, false);

      expect(outcome.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      expect(outcome.humanReason).toBe(HUMAN_REASON.GREY_ZONE);
    });

    it("HIGH gera oferta automatica, sem motivo humano", () => {
      const outcome = decideOutcome(RiskBand.HIGH, false);

      expect(outcome.outcomeType).toBe(OutcomeType.AUTOMATIC_OFFER);
      expect(outcome.humanReason).toBeUndefined();
    });
  });

  describe("interceptacao de alto valor recorrente", () => {
    it("HIGH com alto valor intercepta a oferta e vai para retencao humana", () => {
      const outcome = decideOutcome(RiskBand.HIGH, true);

      expect(outcome.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      expect(outcome.humanReason).toBe(HUMAN_REASON.HIGH_VALUE_AT_HIGH_RISK);
    });

    it("HIGH sem alto valor mantem a oferta automatica (o valor e quem intercepta)", () => {
      expect(decideOutcome(RiskBand.HIGH, false).outcomeType).toBe(OutcomeType.AUTOMATIC_OFFER);
    });
  });

  describe("o alto valor age SOMENTE em HIGH", () => {
    it("GREY com alto valor vai para retencao humana pelo motivo de zona cinzenta, nao pelo valor", () => {
      const outcome = decideOutcome(RiskBand.GREY, true);

      expect(outcome.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      expect(outcome.humanReason).toBe(HUMAN_REASON.GREY_ZONE);
      expect(outcome.humanReason).not.toBe(HUMAN_REASON.HIGH_VALUE_AT_HIGH_RISK);
    });

    it("LOW com alto valor cancela direto: o valor da assinatura e irrelevante fora de HIGH", () => {
      const outcome = decideOutcome(RiskBand.LOW, true);

      expect(outcome.outcomeType).toBe(OutcomeType.CANCELLED);
      expect(outcome.humanReason).toBeUndefined();
    });

    it("em LOW e GREY o resultado e identico com e sem alto valor", () => {
      expect(decideOutcome(RiskBand.LOW, true)).toEqual(decideOutcome(RiskBand.LOW, false));
      expect(decideOutcome(RiskBand.GREY, true)).toEqual(decideOutcome(RiskBand.GREY, false));
    });
  });
});

describe("Regra 3 - decide: fallback de timeout do Agente de Scoring", () => {
  it("assume zona cinzenta e retencao humana quando o scoring nao responde", () => {
    const decision = decide({ timedOut: true });

    expect(decision.band).toBe(RiskBand.GREY);
    expect(decision.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
    expect(decision.humanReason).toBe(HUMAN_REASON.SCORING_TIMEOUT);
  });

  it("nao inventa um risco: a decisao por timeout nao carrega risk", () => {
    const decision = decide({ timedOut: true });

    expect(decision).not.toHaveProperty("risk");
    expect(Object.keys(decision).sort()).toEqual(["band", "humanReason", "outcomeType"]);
  });

  it("distingue timeout de zona cinzenta real, apesar do mesmo par faixa/resultado", () => {
    const porTimeout = decide({ timedOut: true });
    const porZonaCinzenta = decide({ timedOut: false, risk: 0.5, isHighValue: false });

    expect(porTimeout.band).toBe(porZonaCinzenta.band);
    expect(porTimeout.outcomeType).toBe(porZonaCinzenta.outcomeType);
    expect(porTimeout.humanReason).not.toBe(porZonaCinzenta.humanReason);
  });
});

describe("decide: composicao das tres regras", () => {
  const casos: ReadonlyArray<{
    nome: string;
    input: DecisionInput;
    band: RiskBand;
    outcomeType: OutcomeType;
    humanReason?: string;
  }> = [
    {
      nome: "risco baixo",
      input: { timedOut: false, risk: 0.15, isHighValue: false },
      band: RiskBand.LOW,
      outcomeType: OutcomeType.CANCELLED,
    },
    {
      nome: "fronteira inferior exata",
      input: { timedOut: false, risk: 0.3, isHighValue: false },
      band: RiskBand.GREY,
      outcomeType: OutcomeType.HUMAN_RETENTION,
      humanReason: HUMAN_REASON.GREY_ZONE,
    },
    {
      nome: "fronteira superior exata",
      input: { timedOut: false, risk: 0.7, isHighValue: false },
      band: RiskBand.GREY,
      outcomeType: OutcomeType.HUMAN_RETENTION,
      humanReason: HUMAN_REASON.GREY_ZONE,
    },
    {
      nome: "fronteira superior exata com alto valor (ainda GREY, nao intercepta)",
      input: { timedOut: false, risk: 0.7, isHighValue: true },
      band: RiskBand.GREY,
      outcomeType: OutcomeType.HUMAN_RETENTION,
      humanReason: HUMAN_REASON.GREY_ZONE,
    },
    {
      nome: "risco alto sem alto valor",
      input: { timedOut: false, risk: 0.85, isHighValue: false },
      band: RiskBand.HIGH,
      outcomeType: OutcomeType.AUTOMATIC_OFFER,
    },
    {
      nome: "risco alto com alto valor",
      input: { timedOut: false, risk: 0.85, isHighValue: true },
      band: RiskBand.HIGH,
      outcomeType: OutcomeType.HUMAN_RETENTION,
      humanReason: HUMAN_REASON.HIGH_VALUE_AT_HIGH_RISK,
    },
    {
      nome: "timeout do scoring",
      input: { timedOut: true },
      band: RiskBand.GREY,
      outcomeType: OutcomeType.HUMAN_RETENTION,
      humanReason: HUMAN_REASON.SCORING_TIMEOUT,
    },
  ];

  it.each(casos)("$nome", ({ input, band, outcomeType, humanReason }) => {
    const decision = decide(input);

    expect(decision.band).toBe(band);
    expect(decision.outcomeType).toBe(outcomeType);
    expect(decision.humanReason).toBe(humanReason);
  });

  it("so anexa humanReason quando o resultado e retencao humana", () => {
    const comRetencaoHumana = [
      decide({ timedOut: true }),
      decide({ timedOut: false, risk: 0.5, isHighValue: false }),
      decide({ timedOut: false, risk: 0.85, isHighValue: true }),
    ];
    const semRetencaoHumana = [
      decide({ timedOut: false, risk: 0.15, isHighValue: true }),
      decide({ timedOut: false, risk: 0.85, isHighValue: false }),
    ];

    for (const decision of comRetencaoHumana) {
      expect(decision.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      expect(decision.humanReason).toBeDefined();
    }

    for (const decision of semRetencaoHumana) {
      expect(decision.outcomeType).not.toBe(OutcomeType.HUMAN_RETENTION);
      expect(decision.humanReason).toBeUndefined();
    }
  });
});

describe("motivos de retencao humana", () => {
  it("os tres motivos sao distintos entre si", () => {
    const motivos = Object.values(HUMAN_REASON);

    expect(new Set(motivos).size).toBe(motivos.length);
    expect(motivos).toHaveLength(3);
  });

  it("nenhum motivo e vazio", () => {
    for (const motivo of Object.values(HUMAN_REASON)) {
      expect(motivo.trim().length).toBeGreaterThan(0);
    }
  });
});
