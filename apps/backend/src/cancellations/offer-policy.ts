import {
  DEFAULT_OFFER_TYPE,
  INITIAL_OFFER_STATUS,
  type OfferStatus,
  type OfferType,
} from "@repo/contracts";

/**
 * Desconto da oferta automática de retenção, como fração do valor recorrente do plano.
 *
 * É uma **decisão de produto minha**, não da spec: o contracts define o tipo e o status
 * inicial da oferta (`DEFAULT_OFFER_TYPE`, `INITIAL_OFFER_STATUS`), mas não diz quanto
 * descontar. Escolhi 20% por dois motivos:
 *
 * - **Cabe no orçamento que a PoC quer provar.** Um caso de retenção humana custa
 *   `HUMAN_RETENTION_COST_CENTS` (R$ 15). Com o plano Basic (R$ 29), 20% são R$ 5,80 por
 *   ciclo — menos que o custo de um atendimento, já no primeiro mês.
 * - **É um desconto de verdade.** 5% não muda a decisão de quem já decidiu cancelar; 50%
 *   destruiria a margem de quem talvez ficasse de graça.
 *
 * O valor 0.2 coincide numericamente com `HIGH_VALUE_PERCENTILE`, e a coincidência é
 * **acidental**: são grandezas sem relação nenhuma (uma é fração de preço, a outra é
 * percentil de uma distribuição). Por isso a constante é própria — reaproveitar a do
 * contracts aqui seria um acoplamento sem sentido que só apareceria quando alguém mudasse
 * uma das duas.
 */
export const RETENTION_DISCOUNT_RATE = 0.2;

/** Conteúdo da oferta automática gerada para um cancelamento de alto risco. */
export interface OfferPolicy {
  type: OfferType;
  status: OfferStatus;
  amountCents: number;
}

/**
 * Monta a oferta automática para um plano.
 *
 * `amountCents` é o **valor do desconto por ciclo** (quanto o assinante deixa de pagar),
 * não o preço novo. A spec não desambigua o campo; escolhi a leitura em que o número é o
 * benefício, porque é assim que ele vai ser mostrado na tela ("economize R$ X").
 *
 * `Math.round` porque cents são inteiros e 20% de um preço ímpar não é redondo.
 */
export function retentionOfferFor(planPriceCents: number): OfferPolicy {
  return {
    type: DEFAULT_OFFER_TYPE,
    status: INITIAL_OFFER_STATUS,
    amountCents: Math.round(planPriceCents * RETENTION_DISCOUNT_RATE),
  };
}
