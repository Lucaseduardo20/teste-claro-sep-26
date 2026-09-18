import { Inject, Injectable } from "@nestjs/common";
import type { SubscriptionListResponse } from "@repo/contracts";

import {
  SUBSCRIPTIONS_REPOSITORY,
  type SubscriptionsRepository,
} from "@/subscriptions/subscriptions.repository";

/** `GET /subscriptions` — a tela inicial: assinatura + assinante + plano. */
@Injectable()
export class ListSubscriptionsUseCase {
  constructor(
    @Inject(SUBSCRIPTIONS_REPOSITORY)
    private readonly subscriptions: SubscriptionsRepository,
  ) {}

  async execute(): Promise<SubscriptionListResponse> {
    return { subscriptions: await this.subscriptions.listSummaries() };
  }
}
