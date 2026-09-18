import { describe, expect, it } from "vitest";

import { OutcomeType } from "@repo/contracts";

import { outcomeCopy } from "@/lib/outcome-copy";

const MOTIVOS_INTERNOS = [
  "grey zone",
  "scoring agent timeout",
  "high recurring value at high risk",
];

describe("outcomeCopy", () => {
  it("cobre os tres desfechos do contracts mais o estado indeciso", () => {
    const textos = [
      outcomeCopy({ type: OutcomeType.CANCELLED }),
      outcomeCopy({ type: OutcomeType.AUTOMATIC_OFFER }),
      outcomeCopy({ type: OutcomeType.HUMAN_RETENTION }),
      outcomeCopy(undefined),
    ];

    for (const texto of textos) {
      expect(texto.title.length).toBeGreaterThan(0);
      expect(texto.description.length).toBeGreaterThan(0);
    }

    // Quatro mensagens distintas: nenhum desfecho e confundido com outro.
    expect(new Set(textos.map((t) => t.title)).size).toBe(4);
  });

  it("trata outcome ausente como 'em analise', sem quebrar", () => {
    const copy = outcomeCopy(undefined);

    expect(copy.badge).toBe("Em análise");
  });

  describe("o motivo interno NUNCA chega ao assinante", () => {
    it.each(MOTIVOS_INTERNOS)("nao vaza `%s` na mensagem de retencao humana", (motivo) => {
      const copy = outcomeCopy({ type: OutcomeType.HUMAN_RETENTION, humanReason: motivo });
      const tudo = `${copy.badge} ${copy.title} ${copy.description}`.toLowerCase();

      expect(tudo).not.toContain(motivo.toLowerCase());
    });

    it("os tres motivos internos produzem exatamente a MESMA mensagem", () => {
      const mensagens = MOTIVOS_INTERNOS.map((humanReason) =>
        JSON.stringify(outcomeCopy({ type: OutcomeType.HUMAN_RETENTION, humanReason })),
      );

      expect(new Set(mensagens).size).toBe(1);
    });

    it("nao usa jargao do sistema em nenhuma das mensagens", () => {
      const jargao = ["grey", "timeout", "scoring", "risk", "band", "outcome", "churn"];
      const tudo = [
        outcomeCopy({ type: OutcomeType.CANCELLED }),
        outcomeCopy({ type: OutcomeType.AUTOMATIC_OFFER }),
        outcomeCopy({ type: OutcomeType.HUMAN_RETENTION }),
        outcomeCopy(undefined),
      ]
        .map((c) => `${c.badge} ${c.title} ${c.description}`)
        .join(" ")
        .toLowerCase();

      for (const termo of jargao) {
        expect(tudo).not.toContain(termo);
      }
    });
  });
});
