import { HIGH_RISK_THRESHOLD, LOW_RISK_THRESHOLD, RiskBand } from "@repo/contracts";

import { toBand } from "@/decision/risk-band";

describe("Regra 1 - toBand: faixa de risco", () => {
  describe("fronteiras exatas (criterio de aceite)", () => {
    it("classifica o limiar inferior exato (0.30) como GREY, nao como LOW", () => {
      expect(toBand(LOW_RISK_THRESHOLD)).toBe(RiskBand.GREY);
    });

    it("classifica o limiar superior exato (0.70) como GREY, nao como HIGH", () => {
      expect(toBand(HIGH_RISK_THRESHOLD)).toBe(RiskBand.GREY);
    });
  });

  describe("logo abaixo e logo acima das fronteiras", () => {
    it("classifica 0.29 como LOW", () => {
      expect(toBand(0.29)).toBe(RiskBand.LOW);
    });

    it("classifica 0.31 como GREY", () => {
      expect(toBand(0.31)).toBe(RiskBand.GREY);
    });

    it("classifica 0.69 como GREY", () => {
      expect(toBand(0.69)).toBe(RiskBand.GREY);
    });

    it("classifica 0.71 como HIGH", () => {
      expect(toBand(0.71)).toBe(RiskBand.HIGH);
    });
  });

  describe("extremos do intervalo", () => {
    it("classifica risco zero como LOW", () => {
      expect(toBand(0)).toBe(RiskBand.LOW);
    });

    it("classifica risco maximo (1) como HIGH", () => {
      expect(toBand(1)).toBe(RiskBand.HIGH);
    });
  });

  describe("cobertura do intervalo", () => {
    // Varre 0.00 a 1.00 de centesimo em centesimo (a escala que o banco guarda em
    // numeric(3,2)) e confere que toda entrada cai em exatamente uma faixa, coerente
    // com os limiares do contracts. Protege contra o erro classico de trocar `<` por
    // `<=` e abrir um buraco ou uma sobreposicao entre as faixas.
    it("atribui exatamente uma faixa a cada centesimo entre 0.00 e 1.00", () => {
      for (let hundredths = 0; hundredths <= 100; hundredths++) {
        const risk = hundredths / 100;
        const band = toBand(risk);

        const expected =
          risk < LOW_RISK_THRESHOLD
            ? RiskBand.LOW
            : risk > HIGH_RISK_THRESHOLD
              ? RiskBand.HIGH
              : RiskBand.GREY;

        expect(band, `risco ${risk.toFixed(2)}`).toBe(expected);
      }
    });
  });
});
