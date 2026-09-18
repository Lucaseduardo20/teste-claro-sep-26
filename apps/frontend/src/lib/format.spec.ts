import { describe, expect, it } from "vitest";

import { formatCents } from "@/lib/format";

/** O espaço do `Intl` e um NBSP (U+00A0), nao um espaco normal. */
function normalizar(valor: string): string {
  return valor.replace(/ /g, " ");
}

describe("formatCents", () => {
  it.each([
    [2900, "R$ 29,00"],
    [4900, "R$ 49,00"],
    [19900, "R$ 199,00"],
  ])("formata %i cents como %s (os precos do seed)", (cents, esperado) => {
    expect(normalizar(formatCents(cents))).toBe(esperado);
  });

  it("mantem os centavos de um valor quebrado", () => {
    // 20% de R$ 29,00 — o desconto da oferta automatica.
    expect(normalizar(formatCents(580))).toBe("R$ 5,80");
  });

  it("usa separador de milhar do pt-BR, nao do locale da maquina", () => {
    expect(normalizar(formatCents(1234567))).toBe("R$ 12.345,67");
  });

  it("formata zero sem quebrar", () => {
    expect(normalizar(formatCents(0))).toBe("R$ 0,00");
  });
});
