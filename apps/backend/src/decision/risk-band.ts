import { HIGH_RISK_THRESHOLD, LOW_RISK_THRESHOLD, RiskBand } from "@repo/contracts";

/**
 * Regra 1 — converte o risco de churn (0.00–1.00) na faixa de risco.
 *
 * Os limiares vêm de `@repo/contracts` e **nunca** aparecem escritos aqui: trocar a
 * regra por um número na mão é critério de reprovação do teste, e é também o tipo de
 * duplicação que faz a spec e o código divergirem em silêncio.
 *
 * | Faixa  | Risco                | Limite            |
 * | ------ | -------------------- | ----------------- |
 * | `LOW`  | `< 0.30`             | exclusivo         |
 * | `GREY` | `>= 0.30` e `<= 0.70` | inclusivo nas duas pontas |
 * | `HIGH` | `> 0.70`             | exclusivo         |
 *
 * O ponto delicado são as **fronteiras exatas**: `0.30` e `0.70` caem em `GREY`, não
 * nas pontas. A implementação expressa isso pela estrutura, e não por uma cadeia de
 * comparações: só `LOW` e `HIGH` são testados, e `GREY` é o que sobra. Assim é
 * impossível existir um risco que não caia em faixa nenhuma, ou que caia em duas —
 * o erro clássico de escrever `<=` onde devia ser `<` simplesmente não tem onde morar.
 *
 * Função pura: sem I/O, sem framework, sem estado.
 */
export function toBand(risk: number): RiskBand {
  if (risk < LOW_RISK_THRESHOLD) return RiskBand.LOW;
  if (risk > HIGH_RISK_THRESHOLD) return RiskBand.HIGH;

  return RiskBand.GREY;
}
