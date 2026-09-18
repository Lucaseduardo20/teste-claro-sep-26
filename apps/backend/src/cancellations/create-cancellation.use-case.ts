import { Inject, Injectable } from "@nestjs/common";
import { OutcomeType, type Cancellation, type CreateCancellationRequest } from "@repo/contracts";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import {
  CANCELLATIONS_REPOSITORY,
  type CancellationDecision,
  type CancellationsRepository,
} from "@/cancellations/cancellations.repository";
import { retentionOfferFor } from "@/cancellations/offer-policy";
import { SubscriptionNotFoundError } from "@/common/errors/domain-errors";
import { newUuidV7 } from "@/common/uuid";
import { decide } from "@/decision/decision.rules";
import { HighValueService } from "@/plans/high-value.service";
import { ScoringService } from "@/scoring/scoring.service";
import {
  SUBSCRIPTIONS_REPOSITORY,
  type SubscriptionsRepository,
} from "@/subscriptions/subscriptions.repository";

/**
 * `POST /cancellations` — a orquestração que amarra as camadas.
 *
 * Este use case **não decide nada** e **não mede tempo nenhum**. Ele chama, em ordem, as
 * peças que já existem e sabem fazer isso:
 *
 * - `ScoringService` (Tarefa 03) — risco ou timeout, com o deadline aplicado lá dentro;
 * - `HighValueService` — o booleano de alto valor, derivado dos preços do banco;
 * - `decide` (Tarefa 02) — a regra pura que transforma isso em band + outcome.
 *
 * Nada de HTTP entra aqui: a entrada é o tipo do contracts, a saída é a entidade do
 * contracts, e o "não encontrei" é um erro de domínio. É por isso que os testes de
 * orquestração rodam sem servidor e sem banco, injetando fakes dos dois repositórios.
 */
@Injectable()
export class CreateCancellationUseCase {
  constructor(
    @Inject(SUBSCRIPTIONS_REPOSITORY)
    private readonly subscriptions: SubscriptionsRepository,
    @Inject(CANCELLATIONS_REPOSITORY)
    private readonly cancellations: CancellationsRepository,
    private readonly scoring: ScoringService,
    private readonly highValue: HighValueService,
    @InjectPinoLogger(CreateCancellationUseCase.name)
    private readonly logger: PinoLogger,
  ) {}

  async execute(request: CreateCancellationRequest): Promise<Cancellation> {
    const { subscriptionId, rawReason } = request;

    // 1. A assinatura existe? Falhar aqui evita gravar um cancelamento órfão — e a FK
    //    recusaria de qualquer jeito, só que com um erro de banco em vez de um 404 claro.
    const context = await this.subscriptions.findContext(subscriptionId);

    if (context === null) throw new SubscriptionNotFoundError(subscriptionId);

    // 2. Persiste o cancelamento NU, antes de decidir qualquer coisa.
    //
    //    O motivo é de negócio, não técnico: o assinante pediu para cancelar, e esse
    //    pedido é um fato — independente de o scoring responder, demorar ou o processo
    //    morrer no meio. Gravar só no fim significaria perder o rastro de toda tentativa
    //    que falhasse depois deste ponto, justamente as que mais interessam investigar.
    //    Um cancelamento sem outcome é um estado legítimo do schema (Tarefa 01, seção 1.2).
    const pending = await this.cancellations.createPending({
      id: newUuidV7(),
      subscriptionId,
      rawReason,
    });

    this.logger.info(
      { event: "cancellation.received", cancellationId: pending.id, subscriptionId },
      "Cancelamento recebido e persistido sem decisao",
    );

    // 3. Scoring, sob o deadline da Tarefa 03. O `ScoringInput` da spec é este contexto
    //    mais o motivo bruto — daí o `SubscriptionContext` ter exatamente esse formato.
    const scoring = await this.scoring.score({
      subscriber: context.subscriber,
      subscription: context.subscription,
      plan: context.plan,
      engagementEvents: context.engagementEvents,
      paymentEvents: context.paymentEvents,
      rawReason,
    });

    this.logger.info(
      {
        event: scoring.timedOut ? "scoring.timed_out" : "scoring.completed",
        cancellationId: pending.id,
        latencyMs: scoring.latencyMs,
        ...(scoring.timedOut ? {} : { risk: scoring.risk }),
      },
      scoring.timedOut ? "Agente de Scoring estourou o prazo" : "Agente de Scoring respondeu",
    );

    // 4. Decisão. O `isHighValue` só é consultado quando há risco: no timeout a regra é
    //    conservadora independentemente do valor, e a query seria trabalho jogado fora.
    const decision = scoring.timedOut
      ? decide({ timedOut: true })
      : decide({
          timedOut: false,
          risk: scoring.risk,
          isHighValue: await this.highValue.isHighValue(context.plan.priceCents),
        });

    // 5. Grava decisão + oferta numa transação.
    const persisted = await this.cancellations.applyDecision(
      this.toPersistable(pending.id, decision, scoring, context.plan.priceCents),
    );

    this.logger.info(
      {
        event: "cancellation.decided",
        cancellationId: pending.id,
        band: decision.band,
        outcomeType: decision.outcomeType,
        ...(decision.humanReason === undefined ? {} : { humanReason: decision.humanReason }),
      },
      "Outcome decidido",
    );

    return persisted;
  }

  /** Junta decisão, risco e oferta no formato que o repositório grava. */
  private toPersistable(
    id: Cancellation["id"],
    decision: ReturnType<typeof decide>,
    scoring: { timedOut: boolean; risk?: number },
    planPriceCents: number,
  ): CancellationDecision {
    const persistable: CancellationDecision = {
      id,
      band: decision.band,
      outcomeType: decision.outcomeType,
    };

    // No timeout não há risco para gravar — a coluna continua NULL, como a spec manda.
    if (scoring.risk !== undefined) persistable.risk = scoring.risk;
    if (decision.humanReason !== undefined) persistable.humanReason = decision.humanReason;

    // A oferta nasce **só** no caminho da oferta automática. Nos outros dois não existe
    // oferta nenhuma, e criar uma "vazia" poluiria a tabela e a métrica.
    if (decision.outcomeType === OutcomeType.AUTOMATIC_OFFER) {
      persistable.offer = { id: newUuidV7(), ...retentionOfferFor(planPriceCents) };
    }

    return persistable;
  }
}
