import { Module } from "@nestjs/common";

import { CANCELLATIONS_REPOSITORY } from "@/cancellations/cancellations.repository";
import { CancellationsController } from "@/cancellations/cancellations.controller";
import { CreateCancellationUseCase } from "@/cancellations/create-cancellation.use-case";
import { GetCancellationUseCase } from "@/cancellations/get-cancellation.use-case";
import { PrismaCancellationsRepository } from "@/cancellations/prisma-cancellations.repository";
import { PlansModule } from "@/plans/plans.module";
import { ScoringModule } from "@/scoring/scoring.module";
import { SubscriptionsModule } from "@/subscriptions/subscriptions.module";

@Module({
  imports: [ScoringModule, PlansModule, SubscriptionsModule],
  controllers: [CancellationsController],
  providers: [
    { provide: CANCELLATIONS_REPOSITORY, useClass: PrismaCancellationsRepository },
    CreateCancellationUseCase,
    GetCancellationUseCase,
  ],
})
export class CancellationsModule {}
