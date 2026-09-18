import type {
  Cancellation as CancellationRow,
  EngagementEvent as EngagementEventRow,
  Offer as OfferRow,
  PaymentEvent as PaymentEventRow,
  Plan as PlanRow,
  Subscriber as SubscriberRow,
  Subscription as SubscriptionRow,
} from "@prisma/client";
import {
  assertUUIDv7,
  BillingCycle,
  EngagementType,
  OfferStatus,
  OfferType,
  OutcomeType,
  PaymentStatus,
  ReasonCategory,
  RiskBand,
  SubscriptionStatus,
  type Cancellation,
  type CancellationOutcome,
  type EngagementEvent,
  type Offer,
  type PaymentEvent,
  type Plan,
  type Subscriber,
  type Subscription,
} from "@repo/contracts";

/**
 * Tradução linha do banco → entidade do contracts.
 *
 * Três conversões acontecem aqui, e nenhuma é acidental:
 *
 * 1. **`Date` → `ISO8601`.** O contracts tipa todo timestamp como string ISO; o Prisma
 *    devolve `Date`. Esta camada é o único lugar que sabe disso.
 * 2. **`Decimal` → `number`.** `risk` é `numeric(3,2)` no Postgres (ver Tarefa 01, seção
 *    3.5) e chega como `Decimal` do decimal.js. O `.toNumber()` mora aqui.
 * 3. **Enum do Prisma → enum do contracts.** São tipos diferentes: o do Prisma é uma união
 *    de literais de string, o do contracts é um `enum` nominal. `BillingCycle[row.cycle]`
 *    resolve isso **indexando o enum pela chave** — sem `as`, sem `any`, e verificado pelo
 *    compilador nas duas direções: se o Prisma ganhasse um valor que o contracts não tem,
 *    isto pararia de compilar. É de propósito que não há um `as BillingCycle` em lugar
 *    nenhum deste arquivo.
 *
 * O `null` do banco vira **ausência de propriedade**, não `undefined` atribuído: o
 * `exactOptionalPropertyTypes` do tsconfig trata os dois como coisas diferentes, e a spec
 * também — `outcome` ausente é "ainda não decidido".
 */

export function toPlan(row: PlanRow): Plan {
  return {
    id: assertUUIDv7(row.id),
    name: row.name,
    priceCents: row.priceCents,
    cycle: BillingCycle[row.cycle],
    benefits: row.benefits,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSubscriber(row: SubscriberRow): Subscriber {
  return {
    id: assertUUIDv7(row.id),
    name: row.name,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: assertUUIDv7(row.id),
    subscriberId: assertUUIDv7(row.subscriberId),
    planId: assertUUIDv7(row.planId),
    startedAt: row.startedAt.toISOString(),
    status: SubscriptionStatus[row.status],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEngagementEvent(row: EngagementEventRow): EngagementEvent {
  return {
    id: assertUUIDv7(row.id),
    subscriptionId: assertUUIDv7(row.subscriptionId),
    type: EngagementType[row.type],
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPaymentEvent(row: PaymentEventRow): PaymentEvent {
  return {
    id: assertUUIDv7(row.id),
    subscriptionId: assertUUIDv7(row.subscriptionId),
    amountCents: row.amountCents,
    status: PaymentStatus[row.status],
    date: row.date.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOffer(row: OfferRow): Offer {
  const offer: Offer = {
    id: assertUUIDv7(row.id),
    cancellationId: assertUUIDv7(row.cancellationId),
    type: OfferType[row.type],
    status: OfferStatus[row.status],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.amountCents !== null) offer.amountCents = row.amountCents;

  return offer;
}

/**
 * Remonta o `Cancellation` da spec, incluindo o `CancellationOutcome` que foi achatado em
 * colunas na Tarefa 01 (`outcome_type` + `human_reason` na própria tabela, `offer` numa
 * tabela 1:0..1).
 *
 * Se `outcome_type` é `NULL`, o `outcome` simplesmente **não existe** na entidade — que é
 * exatamente o que a spec descreve para um cancelamento ainda não decidido.
 */
export function toCancellation(row: CancellationRow & { offer?: OfferRow | null }): Cancellation {
  const cancellation: Cancellation = {
    id: assertUUIDv7(row.id),
    subscriptionId: assertUUIDv7(row.subscriptionId),
    rawReason: row.rawReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.reasonCategory !== null) cancellation.reasonCategory = ReasonCategory[row.reasonCategory];
  if (row.risk !== null) cancellation.risk = row.risk.toNumber();
  if (row.band !== null) cancellation.band = RiskBand[row.band];

  if (row.outcomeType !== null) {
    const outcome: CancellationOutcome = { type: OutcomeType[row.outcomeType] };

    if (row.humanReason !== null) outcome.humanReason = row.humanReason;
    if (row.offer !== undefined && row.offer !== null) outcome.offer = toOffer(row.offer);

    cancellation.outcome = outcome;
  }

  return cancellation;
}
