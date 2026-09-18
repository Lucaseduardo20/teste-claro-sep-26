import { Module } from "@nestjs/common";

import { ListSubscriptionsUseCase } from "@/subscriptions/list-subscriptions.use-case";
import { PrismaSubscriptionsRepository } from "@/subscriptions/prisma-subscriptions.repository";
import { SubscriptionsController } from "@/subscriptions/subscriptions.controller";
import { SUBSCRIPTIONS_REPOSITORY } from "@/subscriptions/subscriptions.repository";

@Module({
  controllers: [SubscriptionsController],
  providers: [
    { provide: SUBSCRIPTIONS_REPOSITORY, useClass: PrismaSubscriptionsRepository },
    ListSubscriptionsUseCase,
  ],
  // O token sai exportado porque o CancellationsModule precisa do mesmo repositorio
  // para montar o contexto do Agente de Scoring.
  exports: [SUBSCRIPTIONS_REPOSITORY],
})
export class SubscriptionsModule {}
