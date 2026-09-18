import { type MiddlewareConsumer, type NestModule, Module } from "@nestjs/common";

import { AppController } from "@/app.controller";
import { AppService } from "@/app.service";
import { CancellationsModule } from "@/cancellations/cancellations.module";
import { AppLoggerMiddleware } from "@/common/middlewares/app-logger.middleware";
import { DbModule } from "@/db/db.module";
import { PlansModule } from "@/plans/plans.module";
import { PrismaModule } from "@/prisma/prisma.module";
import { ScoringModule } from "@/scoring/scoring.module";
import { SubscriptionsModule } from "@/subscriptions/subscriptions.module";

@Module({
  imports: [
    DbModule,
    PrismaModule,
    PlansModule,
    ScoringModule,
    SubscriptionsModule,
    CancellationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AppLoggerMiddleware).forRoutes("{*splat}");
  }
}
