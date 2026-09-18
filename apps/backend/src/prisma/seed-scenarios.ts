import type { PrismaClient } from "@prisma/client";
import {
  engagementEvents,
  paymentEvents,
  plans,
  scenarios,
  subscribers,
  subscriptions,
} from "@repo/contracts";

export interface SeedCounts {
  scenarios: number;
  plans: number;
  subscribers: number;
  subscriptions: number;
  engagementEvents: number;
  paymentEvents: number;
}

/**
 * Carrega os 7 cenários de `packages/contracts/src/scenarios.ts` no banco.
 *
 * Vive em `src/` (e não dentro do script `prisma/seed.ts`) porque tem dois chamadores: o
 * script de linha de comando e a suíte e2e, que precisa garantir os dados antes de bater
 * nos endpoints. Um seed que só existe como script vira `psql` copiado e colado no teste.
 *
 * Três propriedades, as mesmas desde a Tarefa 01:
 *
 * 1. **Fonte única.** Nada é redigitado: os dados vêm das listas prontas do contracts.
 * 2. **Ids fixos.** UUID v7 determinísticos derivados do id do cenário.
 * 3. **Idempotência.** `upsert` por id, com `update` idêntico ao `create`. Rodar duas
 *    vezes não duplica nem altera linha nenhuma.
 *
 * Carrega só o estado inicial do mundo. Cancelamentos e ofertas nascem em runtime.
 */
export async function seedScenarios(prisma: PrismaClient): Promise<SeedCounts> {
  // `$transaction` com array executa na ordem dada: cadastro antes das FKs que apontam
  // para ele. Tudo ou nada — um seed parcial não é estado válido.
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

  return {
    scenarios: scenarios.length,
    plans: await prisma.plan.count(),
    subscribers: await prisma.subscriber.count(),
    subscriptions: await prisma.subscription.count(),
    engagementEvents: await prisma.engagementEvent.count(),
    paymentEvents: await prisma.paymentEvent.count(),
  };
}
