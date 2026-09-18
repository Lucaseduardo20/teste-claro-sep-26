import type { EngagementEvent, Plan, Subscriber, Subscription, UUIDv7 } from "@repo/contracts";
import type { PaymentEvent } from "@repo/contracts";

export const SUBSCRIPTIONS_REPOSITORY = Symbol("SUBSCRIPTIONS_REPOSITORY");

/** Assinatura com assinante e plano — a forma que `GET /subscriptions` devolve. */
export interface SubscriptionSummary {
  subscription: Subscription;
  subscriber: Subscriber;
  plan: Plan;
}

/**
 * Tudo que o Agente de Scoring precisa ver sobre uma assinatura.
 *
 * É exatamente o `ScoringInput` da spec menos o `rawReason` (que vem do request, não do
 * banco). Modelar assim não é coincidência: a montagem do input do agente vira um spread,
 * sem o use case ter que saber quais campos existem.
 */
export interface SubscriptionContext extends SubscriptionSummary {
  engagementEvents: EngagementEvent[];
  paymentEvents: PaymentEvent[];
}

export interface SubscriptionsRepository {
  /** Assinaturas com assinante e plano, para a tela inicial. */
  listSummaries(): Promise<SubscriptionSummary[]>;

  /** Contexto completo de uma assinatura, ou `null` se ela não existe. */
  findContext(subscriptionId: UUIDv7): Promise<SubscriptionContext | null>;
}
