import { HIGH_VALUE_PERCENTILE, plans } from "@repo/contracts";

import { deriveHighValueCut } from "@/plans/high-value";

describe("Regra de alto valor: o corte e derivado dos precos, nunca fixo", () => {
  describe("com os planos do seed", () => {
    const precosDoSeed = plans.map((plan) => plan.priceCents);

    it("isola apenas o Premium: n=3, k=ceil(0.2*3)=1", () => {
      const corte = deriveHighValueCut(precosDoSeed, HIGH_VALUE_PERCENTILE);

      expect([...corte]).toEqual([19900]);
    });

    it("nao considera Basic nem Standard de alto valor", () => {
      const corte = deriveHighValueCut(precosDoSeed, HIGH_VALUE_PERCENTILE);

      expect(corte.has(2900)).toBe(false);
      expect(corte.has(4900)).toBe(false);
    });
  });

  describe("PROVA de que 199 nao esta hardcoded: mude os precos, o corte muda", () => {
    it("com precos totalmente diferentes, o mais caro vira o de alto valor", () => {
      // Nenhum destes precos existe no seed, e 19900 nem aparece.
      const corte = deriveHighValueCut([1000, 5000, 7000], HIGH_VALUE_PERCENTILE);

      expect([...corte]).toEqual([7000]);
      expect(corte.has(19900)).toBe(false);
    });

    it("se o Premium deixar de ser o mais caro, ele deixa de ser alto valor", () => {
      // Um plano "Ultra" mais caro entra no catalogo. k continua 1 (n=4 -> ceil(0.8)=1),
      // entao o corte passa a ser so o Ultra — e o Premium cai fora.
      const corte = deriveHighValueCut([2900, 4900, 19900, 49900], HIGH_VALUE_PERCENTILE);

      expect([...corte]).toEqual([49900]);
      expect(corte.has(19900)).toBe(false);
    });

    it("com 199 sendo o preco mais BARATO, ele nao e alto valor", () => {
      const corte = deriveHighValueCut([19900, 29900, 39900], HIGH_VALUE_PERCENTILE);

      expect(corte.has(19900)).toBe(false);
      expect([...corte]).toEqual([39900]);
    });

    it("com um plano so, esse plano e alto valor, qualquer que seja o preco", () => {
      expect([...deriveHighValueCut([2900], HIGH_VALUE_PERCENTILE)]).toEqual([2900]);
    });
  });

  describe("a formula: k = ceil(percentil * n) sobre precos DISTINTOS", () => {
    const dez = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

    it("com 10 precos e 20%, pega os 2 maiores", () => {
      expect([...deriveHighValueCut(dez, 0.2)]).toEqual([900, 1000]);
    });

    it("com 10 precos e 50%, pega os 5 maiores", () => {
      expect([...deriveHighValueCut(dez, 0.5)]).toEqual([600, 700, 800, 900, 1000]);
    });

    it("arredonda para CIMA: 10 precos e 11% ja pegam 2", () => {
      expect([...deriveHighValueCut(dez, 0.11)]).toEqual([900, 1000]);
    });

    it("conta precos distintos, nao planos: repetidos nao inflam o n", () => {
      // Seis planos, tres precos distintos -> k = ceil(0.2*3) = 1, nao ceil(0.2*6) = 2.
      const corte = deriveHighValueCut([2900, 2900, 4900, 4900, 19900, 19900], 0.2);

      expect([...corte]).toEqual([19900]);
    });

    it("nao depende da ordem de entrada", () => {
      const desordenado = deriveHighValueCut([19900, 2900, 4900], HIGH_VALUE_PERCENTILE);
      const ordenado = deriveHighValueCut([2900, 4900, 19900], HIGH_VALUE_PERCENTILE);

      expect([...desordenado]).toEqual([...ordenado]);
    });
  });

  describe("extremos", () => {
    it("sem planos cadastrados, ninguem e de alto valor", () => {
      expect(deriveHighValueCut([], HIGH_VALUE_PERCENTILE).size).toBe(0);
    });

    it("percentil zero nao elege ninguem", () => {
      expect(deriveHighValueCut([100, 200, 300], 0).size).toBe(0);
    });

    it("percentil 1 elege todo mundo, sem estourar a lista", () => {
      expect([...deriveHighValueCut([100, 200, 300], 1)]).toEqual([100, 200, 300]);
    });

    it("percentil acima de 1 nao quebra nem repete", () => {
      expect([...deriveHighValueCut([100, 200, 300], 2)]).toEqual([100, 200, 300]);
    });
  });
});
