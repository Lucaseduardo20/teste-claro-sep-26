/**
 * Seed dos 7 cenários de `packages/contracts/src/scenarios.ts`.
 *
 * Três propriedades importam aqui:
 *
 * 1. **Fonte única.** Nada é redigitado: os dados vêm das listas já prontas que o
 *    contracts exporta (`plans`, `subscribers`, `subscriptions`, `engagementEvents`,
 *    `paymentEvents`). Se o avaliador mudar um preço no `scenarios.ts`, o seed segue.
 * 2. **Ids fixos.** Os ids são UUID v7 determinísticos derivados do id do cenário.
 *    Cada linha é gravada com o id que o contracts declara — é isso que permite ao
 *    mock do Agente de Scoring achar o cenário por `subscriptionId`.
 * 3. **Idempotência.** Tudo é `upsert` por id, e o payload de `update` é igual ao de
 *    `create`. Rodar duas vezes não duplica nem altera nenhuma linha.
 *
 * O seed carrega só o **estado inicial** do mundo: assinantes, planos, assinaturas e
 * histórico de eventos. Cancelamentos e ofertas não entram — eles nascem em runtime,
 * via `POST /cancellations`. O `expectedOutcome` dos cenários é a asserção dos testes,
 * não um dado a ser inserido.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  engagementEvents,
  paymentEvents,
  plans,
  scenarios,
  subscribers,
  subscriptions,
} from "@repo/contracts";

// Mesmo fallback de `src/db/db.module.ts` e de `prisma.config.ts`.
const connectionString =
  process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/smart_retention";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  // `$transaction` com array executa na ordem dada: cadastro antes das FKs que
  // apontam para ele. Tudo ou nada — um seed parcial não é estado válido.
  await prisma.$transaction([
    ...plans.map(({ id, ...plan }) => {
      const data = { ...plan, benefits: [...plan.benefits], createdAt: new Date(plan.createdAt) };
      return prisma.plan.upsert({ where: { id }, create: { id, ...data }, update: data });
    }),

    ...subscribers.map(({ id, ...subscriber }) => {
      const data = { ...subscriber, createdAt: new Date(subscriber.createdAt) };
      return prisma.subscriber.upsert({ where: { id }, create: { id, ...data }, update: data });
    }),

    ...subscriptions.map(({ id, ...subscription }) => {
      const data = {
        ...subscription,
        startedAt: new Date(subscription.startedAt),
        createdAt: new Date(subscription.createdAt),
        updatedAt: new Date(subscription.updatedAt),
      };
      return prisma.subscription.upsert({ where: { id }, create: { id, ...data }, update: data });
    }),

    ...engagementEvents.map(({ id, ...event }) => {
      const data = {
        ...event,
        occurredAt: new Date(event.occurredAt),
        createdAt: new Date(event.createdAt),
      };
      return prisma.engagementEvent.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    }),

    ...paymentEvents.map(({ id, ...event }) => {
      const data = { ...event, date: new Date(event.date), createdAt: new Date(event.createdAt) };
      return prisma.paymentEvent.upsert({ where: { id }, create: { id, ...data }, update: data });
    }),
  ]);

  const counts = {
    scenarios: scenarios.length,
    plans: await prisma.plan.count(),
    subscribers: await prisma.subscriber.count(),
    subscriptions: await prisma.subscription.count(),
    engagementEvents: await prisma.engagementEvent.count(),
    paymentEvents: await prisma.paymentEvent.count(),
  };

  console.info("seed concluido", counts);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
