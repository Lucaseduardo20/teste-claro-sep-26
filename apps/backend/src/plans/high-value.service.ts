import { Inject, Injectable } from "@nestjs/common";
import { HIGH_VALUE_PERCENTILE } from "@repo/contracts";

import { deriveHighValueCut } from "@/plans/high-value";
import { PLANS_REPOSITORY, type PlansRepository } from "@/plans/plans.repository";

/**
 * Responde "esta assinatura é de alto valor recorrente?" — a metade da regra que a
 * Tarefa 02 recebeu pronta como booleano.
 *
 * A divisão continua valendo: a **fórmula** é a função pura `deriveHighValueCut`; **de
 * onde vêm os preços** é o repositório; e a **política** de o que fazer com o resultado é
 * da regra de decisão, que nem sabe que este service existe.
 *
 * O corte é calculado a cada chamada, sem cache. Com uma tabela de dimensão de poucas
 * linhas isso custa quase nada, e a alternativa (cache) teria que ser invalidada quando
 * um plano fosse cadastrado ou tivesse o preço alterado — exatamente o cenário que a spec
 * diz que o avaliador vai exercitar.
 */
@Injectable()
export class HighValueService {
  constructor(@Inject(PLANS_REPOSITORY) private readonly plans: PlansRepository) {}

  /** Conjunto dos `priceCents` considerados de alto valor, derivado dos planos cadastrados. */
  async highValueCut(): Promise<ReadonlySet<number>> {
    return deriveHighValueCut(await this.plans.distinctPriceCents(), HIGH_VALUE_PERCENTILE);
  }

  async isHighValue(priceCents: number): Promise<boolean> {
    return (await this.highValueCut()).has(priceCents);
  }
}
