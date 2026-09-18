import { Module, ValidationPipe } from "@nestjs/common";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";

import { AppController } from "@/app.controller";
import { AppService } from "@/app.service";
import { CancellationsModule } from "@/cancellations/cancellations.module";
import { AllExceptionsFilter } from "@/common/filters/all-exceptions.filter";
import { buildLoggerOptions } from "@/common/logging/logger.options";
import { DbModule } from "@/db/db.module";
import { PlansModule } from "@/plans/plans.module";
import { PrismaModule } from "@/prisma/prisma.module";
import { ScoringModule } from "@/scoring/scoring.module";
import { SubscriptionsModule } from "@/subscriptions/subscriptions.module";

@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerOptions()),
    DbModule,
    PrismaModule,
    PlansModule,
    ScoringModule,
    SubscriptionsModule,
    CancellationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Filtro e pipe entram por provider (e não por `app.useGlobal*`) para receberem
    // injeção de dependência — o filtro precisa do logger.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          // Campos fora do DTO não chegam ao use case...
          whitelist: true,
          // ...e mandar um campo desconhecido é erro explícito, não descarte silencioso.
          forbidNonWhitelisted: true,
          transform: true,
        }),
    },
  ],
})
export class AppModule {}
