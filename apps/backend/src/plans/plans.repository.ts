/** Token de injeção do repositório de planos. Ver `scoring.tokens.ts` para o porquê do Symbol. */
export const PLANS_REPOSITORY = Symbol("PLANS_REPOSITORY");

/**
 * Porta de leitura de planos.
 *
 * Um método só, de propósito: é tudo que a regra de alto valor precisa do banco. Manter a
 * porta estreita é o que permite ao teste do `HighValueService` entregar uma lista de
 * preços qualquer sem subir Postgres.
 */
export interface PlansRepository {
  /** `SELECT DISTINCT price_cents FROM plans ORDER BY price_cents` */
  distinctPriceCents(): Promise<number[]>;
}
