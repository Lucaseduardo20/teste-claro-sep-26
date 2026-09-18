import { Module } from "@nestjs/common";

import { HighValueService } from "@/plans/high-value.service";
import { PLANS_REPOSITORY } from "@/plans/plans.repository";
import { PrismaPlansRepository } from "@/plans/prisma-plans.repository";

@Module({
  providers: [{ provide: PLANS_REPOSITORY, useClass: PrismaPlansRepository }, HighValueService],
  exports: [HighValueService, PLANS_REPOSITORY],
})
export class PlansModule {}
