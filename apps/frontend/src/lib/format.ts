/**
 * Valores monetários chegam da API em **cents** (inteiros), como o contracts define
 * (`priceCents`, `amountCents`). A conversão para o que o assinante lê acontece só aqui,
 * na borda de apresentação — nunca no meio de um componente.
 *
 * `Intl.NumberFormat` com locale fixo em `pt-BR`: o formato não pode depender da máquina
 * de quem abre a página. Um assinante brasileiro tem que ver `R$ 199,00`, e não
 * `R$ 199.00`, mesmo com o navegador em inglês.
 */
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const CENTS_PER_UNIT = 100;

/** `2900` → `"R$ 29,00"`. */
export function formatCents(cents: number): string {
  return BRL.format(cents / CENTS_PER_UNIT);
}
