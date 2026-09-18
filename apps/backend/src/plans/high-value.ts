/**
 * Regra de alto valor recorrente — a **fórmula**, isolada de onde os preços vêm.
 *
 * A spec fixa o cálculo no README do contracts: ordene os `priceCents` **distintos**
 * cadastrados em ordem crescente, calcule `k = ceil(HIGH_VALUE_PERCENTILE * n)` com `n`
 * = quantidade de preços distintos, e os `k` maiores preços são de alto valor.
 *
 * Com os 3 planos do seed: `n = 3`, `k = ceil(0.2 * 3) = ceil(0.6) = 1` → só o Premium.
 * Esse "só o Premium" é **consequência**, nunca premissa: mude os preços cadastrados e o
 * corte muda junto, que é exatamente o que a spec exige ("o avaliador pode alterar preços
 * do seed e revalidar").
 *
 * Função pura: recebe a lista de preços e o percentil, devolve o conjunto de corte. Não
 * conhece banco, não conhece Prisma, não importa constante nenhuma — o percentil chega
 * como parâmetro para que o teste possa variá-lo e provar que a derivação é real.
 */
export function deriveHighValueCut(
  priceCents: readonly number[],
  percentile: number,
): ReadonlySet<number> {
  const distinct = [...new Set(priceCents)].sort((a, b) => a - b);

  if (distinct.length === 0) return new Set();

  // `ceil` porque a spec manda arredondar para cima: com 3 preços e 20%, 0.6 vira 1 plano
  // de alto valor, não zero. Um percentil que zere o corte não deixaria nenhum plano de
  // alto valor, e um acima de 1 não pode passar do total de preços.
  const k = Math.min(Math.max(Math.ceil(percentile * distinct.length), 0), distinct.length);

  return new Set(distinct.slice(distinct.length - k));
}
