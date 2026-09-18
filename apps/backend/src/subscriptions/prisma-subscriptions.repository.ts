import { Injectable } from "@nestjs/common";
import type { UUIDv7 } from "@repo/contracts";

import {
  toEngagementEvent,
  toPaymentEvent,
  toPlan,
  toSubscriber,
  toSubscription,
} from "@/persistence/domain-mapper";
import { PrismaService } from "@/prisma/prisma.service";
import type {
  SubscriptionContext,
  SubscriptionsRepository,
  SubscriptionSummary,
} from "@/subscriptions/subscriptions.repository";

@Injectable()
export class PrismaSubscriptionsRepository implements SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Uma consulta só, com `include`: o Prisma emite um JOIN para `subscriber` e `plan` em
   * vez de N+1 (uma query da lista + duas por linha). Com 7 assinaturas a diferença é
   * invisível; com 7 mil seriam 14 mil round-trips.
   */
  async listSummaries(): Promise<SubscriptionSummary[]> {
    const rows = await this.prisma.subscription.findMany({
      include: { subscriber: true, plan: true },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => ({
      subscription: toSubscription(row),
      subscriber: toSubscriber(row.subscriber),
      plan: toPlan(row.plan),
    }));
  }

  /**
   * Monta o contexto do Agente de Scoring numa consulta só.
   *
   * O `include` aninhado traz assinante, plano e os dois históricos de evento junto. É por
   * isso que os índices `(subscription_id, occurred_at)` e `(subscription_id, date)` da
   * Tarefa 01 existem: esta é a consulta que eles servem, e ela roda em todo `POST
   * /cancellations`.
   */
  async findContext(subscriptionId: UUIDv7): Promise<SubscriptionContext | null> {
    const row = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        subscriber: true,
        plan: true,
        engagementEvents: { orderBy: { occurredAt: "desc" } },
        paymentEvents: { orderBy: { date: "desc" } },
      },
    });

    if (row === null) return null;

    return {
      subscription: toSubscription(row),
      subscriber: toSubscriber(row.subscriber),
      plan: toPlan(row.plan),
      engagementEvents: row.engagementEvents.map(toEngagementEvent),
      paymentEvents: row.paymentEvents.map(toPaymentEvent),
    };
  }
}
