import { Test, type TestingModule } from "@nestjs/testing";
import {
  OfferStatus,
  OfferType,
  OutcomeType,
  RiskBand,
  scenarios,
  type Cancellation,
  type UUIDv7,
} from "@repo/contracts";
import { getLoggerToken } from "nestjs-pino";

import {
  CANCELLATIONS_REPOSITORY,
  type CancellationDecision,
  type CancellationDetail,
  type CancellationsRepository,
  type PendingCancellation,
} from "@/cancellations/cancellations.repository";
import { CreateCancellationUseCase } from "@/cancellations/create-cancellation.use-case";
import { RETENTION_DISCOUNT_RATE } from "@/cancellations/offer-policy";
import { SubscriptionNotFoundError } from "@/common/errors/domain-errors";
import { HighValueService } from "@/plans/high-value.service";
import { ScoringService, type ScoringOutcome } from "@/scoring/scoring.service";
import {
  SUBSCRIPTIONS_REPOSITORY,
  type SubscriptionContext,
  type SubscriptionsRepository,
} from "@/subscriptions/subscriptions.repository";

function scenarioById(id: string): (typeof scenarios)[number] {
  const scenario = scenarios.find((candidate) => candidate.id === id);

  if (scenario === undefined) throw new Error(`Cenario "${id}" nao existe`);

  return scenario;
}

function contextFor(scenarioId: string): SubscriptionContext {
  const scenario = scenarioById(scenarioId);

  return {
    subscription: scenario.subscription,
    subscriber: scenario.subscriber,
    plan: scenario.plan,
    engagementEvents: scenario.engagementEvents,
    paymentEvents: scenario.paymentEvents,
  };
}

/** Registra a ordem das chamadas entre os dubles, que e o que este teste prova. */
class CallLog {
  readonly calls: string[] = [];

  record(call: string): void {
    this.calls.push(call);
  }
}

class FakeCancellationsRepository implements CancellationsRepository {
  pending?: PendingCancellation;
  applied?: CancellationDecision;

  constructor(private readonly log: CallLog) {}

  createPending(pending: PendingCancellation): Promise<Cancellation> {
    this.log.record("createPending");
    this.pending = pending;

    return Promise.resolve({
      id: pending.id,
      subscriptionId: pending.subscriptionId,
      rawReason: pending.rawReason,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  }

  applyDecision(decision: CancellationDecision): Promise<Cancellation> {
    this.log.record("applyDecision");
    this.applied = decision;

    const cancellation: Cancellation = {
      id: decision.id,
      subscriptionId: this.pending?.subscriptionId ?? decision.id,
      rawReason: this.pending?.rawReason ?? "",
      band: decision.band,
      outcome: { type: decision.outcomeType },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
    };

    if (decision.risk !== undefined) cancellation.risk = decision.risk;

    return Promise.resolve(cancellation);
  }

  findDetail(): Promise<CancellationDetail | null> {
    return Promise.resolve(null);
  }
}

interface Harness {
  useCase: CreateCancellationUseCase;
  repository: FakeCancellationsRepository;
  log: CallLog;
  highValueCalls: number;
}

async function createHarness(options: {
  context: SubscriptionContext | null;
  scoring: ScoringOutcome;
  isHighValue?: boolean;
}): Promise<Harness> {
  const log = new CallLog();
  const repository = new FakeCancellationsRepository(log);
  const harness: Harness = {
    useCase: undefined as unknown as CreateCancellationUseCase,
    repository,
    log,
    highValueCalls: 0,
  };

  const subscriptions: SubscriptionsRepository = {
    listSummaries: () => Promise.resolve([]),
    findContext: () => {
      log.record("findContext");

      return Promise.resolve(options.context);
    },
  };

  const scoring = {
    score: () => {
      log.record("score");

      return Promise.resolve(options.scoring);
    },
  };

  const highValue = {
    isHighValue: () => {
      log.record("isHighValue");
      harness.highValueCalls += 1;

      return Promise.resolve(options.isHighValue ?? false);
    },
  };

  // Logger de verdade seria ruido; o duble prova de quebra que o use case nao depende de
  // nada do pino alem de `info`.
  const logger = { info: (): void => undefined, warn: (): void => undefined };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CreateCancellationUseCase,
      { provide: SUBSCRIPTIONS_REPOSITORY, useValue: subscriptions },
      { provide: CANCELLATIONS_REPOSITORY, useValue: repository },
      { provide: ScoringService, useValue: scoring },
      { provide: HighValueService, useValue: highValue },
      { provide: getLoggerToken(CreateCancellationUseCase.name), useValue: logger },
    ],
  }).compile();

  harness.useCase = module.get(CreateCancellationUseCase);

  return harness;
}

const RISCO_ALTO = 0.85;
const LATENCIA = 300;

describe("CreateCancellationUseCase: orquestracao sem HTTP e sem banco", () => {
  describe("ordem do fluxo", () => {
    it("persiste o cancelamento NU antes de chamar o Agente de Scoring", async () => {
      const { useCase, log } = await createHarness({
        context: contextFor("scenario-low"),
        scoring: { timedOut: false, risk: 0.15, latencyMs: LATENCIA },
      });

      await useCase.execute({
        subscriptionId: contextFor("scenario-low").subscription.id,
        rawReason: "vou viajar",
      });

      expect(log.calls).toEqual([
        "findContext",
        "createPending",
        "score",
        "isHighValue",
        "applyDecision",
      ]);
      expect(log.calls.indexOf("createPending")).toBeLessThan(log.calls.indexOf("score"));
    });

    it("o cancelamento nu nao carrega risco, faixa nem outcome", async () => {
      const { useCase, repository } = await createHarness({
        context: contextFor("scenario-low"),
        scoring: { timedOut: false, risk: 0.15, latencyMs: LATENCIA },
      });

      await useCase.execute({
        subscriptionId: contextFor("scenario-low").subscription.id,
        rawReason: "vou viajar",
      });

      expect(Object.keys(repository.pending ?? {}).sort()).toEqual([
        "id",
        "rawReason",
        "subscriptionId",
      ]);
    });

    it("gera um id novo para o cancelamento, diferente do id da assinatura", async () => {
      const context = contextFor("scenario-low");
      const { useCase, repository } = await createHarness({
        context,
        scoring: { timedOut: false, risk: 0.15, latencyMs: LATENCIA },
      });

      await useCase.execute({ subscriptionId: context.subscription.id, rawReason: "x" });

      expect(repository.pending?.id).not.toBe(context.subscription.id);
      expect(repository.pending?.subscriptionId).toBe(context.subscription.id);
    });
  });

  describe("assinatura inexistente", () => {
    it("lanca erro de dominio e nao persiste nada", async () => {
      const { useCase, log } = await createHarness({
        context: null,
        scoring: { timedOut: false, risk: 0.15, latencyMs: LATENCIA },
      });

      await expect(
        useCase.execute({
          subscriptionId: "01a0b1e9-0000-7000-8000-000000000000" as UUIDv7,
          rawReason: "x",
        }),
      ).rejects.toBeInstanceOf(SubscriptionNotFoundError);

      expect(log.calls).toEqual(["findContext"]);
    });
  });

  describe("a oferta nasce so no caminho da oferta automatica", () => {
    it("cria a oferta em AUTOMATIC_OFFER, com desconto sobre o preco do plano", async () => {
      const context = contextFor("scenario-high");
      const { useCase, repository } = await createHarness({
        context,
        scoring: { timedOut: false, risk: RISCO_ALTO, latencyMs: LATENCIA },
        isHighValue: false,
      });

      await useCase.execute({ subscriptionId: context.subscription.id, rawReason: "caro" });

      expect(repository.applied?.outcomeType).toBe(OutcomeType.AUTOMATIC_OFFER);
      expect(repository.applied?.offer).toMatchObject({
        type: OfferType.DISCOUNT,
        status: OfferStatus.PENDING,
        amountCents: Math.round(context.plan.priceCents * RETENTION_DISCOUNT_RATE),
      });
    });

    it("nao cria oferta quando o outcome e CANCELLED", async () => {
      const context = contextFor("scenario-low");
      const { useCase, repository } = await createHarness({
        context,
        scoring: { timedOut: false, risk: 0.15, latencyMs: LATENCIA },
      });

      await useCase.execute({ subscriptionId: context.subscription.id, rawReason: "x" });

      expect(repository.applied?.outcomeType).toBe(OutcomeType.CANCELLED);
      expect(repository.applied?.offer).toBeUndefined();
    });

    it("nao cria oferta quando alto valor intercepta e manda para o humano", async () => {
      const context = contextFor("scenario-high-value-high");
      const { useCase, repository } = await createHarness({
        context,
        scoring: { timedOut: false, risk: 0.8, latencyMs: LATENCIA },
        isHighValue: true,
      });

      await useCase.execute({ subscriptionId: context.subscription.id, rawReason: "x" });

      expect(repository.applied?.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      expect(repository.applied?.offer).toBeUndefined();
      expect(repository.applied?.humanReason).toBe("high recurring value at high risk");
    });
  });

  describe("timeout do scoring", () => {
    it("grava GREY + retencao humana sem risco nenhum", async () => {
      const context = contextFor("scenario-timeout");
      const { useCase, repository } = await createHarness({
        context,
        scoring: { timedOut: true, latencyMs: LATENCIA },
      });

      await useCase.execute({ subscriptionId: context.subscription.id, rawReason: "x" });

      expect(repository.applied?.band).toBe(RiskBand.GREY);
      expect(repository.applied?.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      expect(repository.applied?.humanReason).toBe("scoring agent timeout");
      expect(repository.applied?.risk).toBeUndefined();
      expect(repository.applied).not.toHaveProperty("risk");
    });

    it("nem consulta a regra de alto valor: no timeout ela nao muda nada", async () => {
      const context = contextFor("scenario-timeout");
      const harness = await createHarness({
        context,
        scoring: { timedOut: true, latencyMs: LATENCIA },
        isHighValue: true,
      });

      await harness.useCase.execute({ subscriptionId: context.subscription.id, rawReason: "x" });

      expect(harness.highValueCalls).toBe(0);
      expect(harness.log.calls).not.toContain("isHighValue");
    });
  });

  describe("o use case nao reimplementa a regra: delega para decide()", () => {
    it("mesmo risco com e sem alto valor muda o outcome so em HIGH", async () => {
      const context = contextFor("scenario-high-value-high");

      const semAltoValor = await createHarness({
        context,
        scoring: { timedOut: false, risk: RISCO_ALTO, latencyMs: LATENCIA },
        isHighValue: false,
      });
      await semAltoValor.useCase.execute({
        subscriptionId: context.subscription.id,
        rawReason: "x",
      });

      const comAltoValor = await createHarness({
        context,
        scoring: { timedOut: false, risk: RISCO_ALTO, latencyMs: LATENCIA },
        isHighValue: true,
      });
      await comAltoValor.useCase.execute({
        subscriptionId: context.subscription.id,
        rawReason: "x",
      });

      expect(semAltoValor.repository.applied?.outcomeType).toBe(OutcomeType.AUTOMATIC_OFFER);
      expect(comAltoValor.repository.applied?.outcomeType).toBe(OutcomeType.HUMAN_RETENTION);
      // A faixa e a mesma nos dois: quem muda e a politica, nao a classificacao.
      expect(semAltoValor.repository.applied?.band).toBe(RiskBand.HIGH);
      expect(comAltoValor.repository.applied?.band).toBe(RiskBand.HIGH);
    });
  });
});
