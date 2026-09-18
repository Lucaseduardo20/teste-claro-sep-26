import { Inject, Injectable } from "@nestjs/common";
import type { CancellationDetailResponse, UUIDv7 } from "@repo/contracts";

import {
  CANCELLATIONS_REPOSITORY,
  type CancellationsRepository,
} from "@/cancellations/cancellations.repository";
import { CancellationNotFoundError } from "@/common/errors/domain-errors";

/**
 * `GET /cancellations/:id`.
 *
 * A remontagem do `CancellationOutcome` (a partir de `outcome_type`, `human_reason` e a
 * oferta relacionada) acontece no mapper de persistência, não aqui — é tradução de
 * formato, não regra. Este use case só decide o que fazer quando não existe.
 */
@Injectable()
export class GetCancellationUseCase {
  constructor(
    @Inject(CANCELLATIONS_REPOSITORY)
    private readonly cancellations: CancellationsRepository,
  ) {}

  async execute(cancellationId: UUIDv7): Promise<CancellationDetailResponse> {
    const detail = await this.cancellations.findDetail(cancellationId);

    if (detail === null) throw new CancellationNotFoundError(cancellationId);

    return detail;
  }
}
