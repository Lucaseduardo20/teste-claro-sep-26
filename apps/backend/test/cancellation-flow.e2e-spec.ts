import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  OfferStatus,
  OfferType,
  OutcomeType,
  RiskBand,
  scenarios,
  type CancellationDetailResponse,
  type CreateCancellationResponse,
  type ScoringAgent,
  type ScoringInput,
  type ScoringResult,
  type SubscriptionListResponse,
} from "@repo/contracts";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "@/app.module";
import { RETENTION_DISCOUNT_RATE } from "@/cancellations/offer-policy";
import { resolveDatabaseUrl } from "@/db/database-url";
import { SCORING_AGENT } from "@/scoring/scoring.tokens";
import { seedScenarios } from "@/prisma/seed-scenarios";

/**
 * e2e do fluxo principal: HTTP de verdade, Nest de verdade, Postgres de verdade.
 *
 * O único duble é o Agente de Scoring, trocado por injeção no token `SCORING_AGENT`. Ele
 * devolve o risco do cenário **sem latência**, porque a latência simulada do mock (200 a
 * 1500ms por chamada) faria esta suíte levar dez segundos sem provar nada a mais — o
 * mecanismo do deadline já tem os seus próprios testes na Tarefa 03. A exceção é o
 * cenário de timeout, que aqui exercita o deadline real: ver o comentário no teste.
 *
 * Se o Postgres não estiver de pé, a suíte é **pulada com aviso** em vez de falhar, para
 * `pnpm verify` continuar verde num clone sem Docker — que é a promessa que o scaffold
 * fazia antes de eu encostar nele. Em CI, `E2E_REQUIRE_DB=1` transforma a ausência do
 * banco em erro, que é o comportamento certo lá.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
});

const databaseUp = await prisma.$queryRaw`select 1`.then(() => true).catch(() => false);

if (!databaseUp) {
  const aviso =
    "Postgres indisponivel: os e2e do fluxo de cancelamento foram PULADOS. " +
    "Rode `pnpm db:up && pnpm --filter @repo/backend db:migrate` para exercita-los.";

  if (process.env["E2E_REQUIRE_DB"] === "1") throw new Error(aviso);

  console.warn(aviso);
}

const suite = databaseUp ? describe : describe.skip;

function scenarioById(id: string): (typeof scenarios)[number] {
  const scenario = scenarios.find((candidate) => candidate.id === id);

  if (scenario === undefined) throw new Error(`Cenario "${id}" nao existe`);

  return scenario;
}

/** Agente instantâneo: devolve o risco que o cenário declara, sem esperar. */
const agenteInstantaneo: ScoringAgent = {
  score(input: ScoringInput): Promise<ScoringResult> {
    const scenario = scenarios.find((s) => s.subscription.id === input.subscription.id);

    // O cenário de timeout devolve uma promessa que NUNCA resolve. É o mais fiel ao que
    // um agente travado faz, e deixa o `Promise.race` do ScoringService cortar no prazo
    // real (~3s). Este e o unico teste lento da suite, e e lento de proposito.
    if (scenario?.simulateTimeout === true) return new Promise<ScoringResult>(() => undefined);

    return Promise.resolve({
      risk: scenario?.expectedRisk ?? 0.5,
      rationale: "fake e2e agent",
      latencyMs: 1,
      timedOut: false,
    });
  },
};

suite("Fluxo de cancelamento (e2e)", () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    // Idempotente: garante os 7 cenarios sem depender de alguem ter rodado o seed antes.
    await seedScenarios(prisma);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SCORING_AGENT)
      .useValue(agenteInstantaneo)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function cancelar(scenarioId: string, rawReason = "teste e2e") {
    const scenario = scenarioById(scenarioId);
    const response = await request(server)
      .post("/cancellations")
      .send({ subscriptionId: scenario.subscription.id, rawReason })
      .expect(201);

    return (response.body as CreateCancellationResponse).cancellation;
  }

  describe("GET /subscriptions", () => {
    it("lista as assinaturas com assinante e plano", async () => {
      const response = await request(server).get("/subscriptions").expect(200);
      const body = response.body as SubscriptionListResponse;

      expect(body.subscriptions.length).toBeGreaterThanOrEqual(scenarios.length);

      const primeira = body.subscriptions[0];

      expect(Object.keys(primeira ?? {}).sort()).toEqual(["plan", "subscriber", "subscription"]);
      expect(primeira?.subscription.subscriberId).toBe(primeira?.subscriber.id);
      expect(primeira?.subscription.planId).toBe(primeira?.plan.id);
      expect(typeof primeira?.plan.priceCents).toBe("number");
    });

    it("traz todos os cenarios do seed", async () => {
      const response = await request(server).get("/subscriptions").expect(200);
      const ids = (response.body as SubscriptionListResponse).subscriptions.map(
        (item) => item.subscription.id,
      );

      for (const scenario of scenarios) {
        expect(ids).toContain(scenario.subscription.id);
      }
    });
  });

  describe("POST /cancellations: os outcomes dos cenarios", () => {
    it("scenario-low: risco baixo cancela direto, sem oferta", async () => {
      const cancellation = await cancelar("scenario-low");

      expect(cancellation.risk).toBe(0.15);
      expect(cancellation.band).toBe(RiskBand.LOW);
      expect(cancellation.outcome?.type).toBe(OutcomeType.CANCELLED);
      expect(cancellation.outcome?.offer).toBeUndefined();
      expect(cancellation.outcome?.humanReason).toBeUndefined();
    });

    it("scenario-high: risco alto em plano barato gera oferta automatica", async () => {
      const scenario = scenarioById("scenario-high");
      const cancellation = await cancelar("scenario-high");

      expect(cancellation.band).toBe(RiskBand.HIGH);
      expect(cancellation.outcome?.type).toBe(OutcomeType.AUTOMATIC_OFFER);
      expect(cancellation.outcome?.offer).toMatchObject({
        type: OfferType.DISCOUNT,
        status: OfferStatus.PENDING,
        amountCents: Math.round(scenario.plan.priceCents * RETENTION_DISCOUNT_RATE),
        cancellationId: cancellation.id,
      });
    });

    it("scenario-high-value-high: alto valor intercepta a oferta e manda para o humano", async () => {
      const cancellation = await cancelar("scenario-high-value-high");

      expect(cancellation.band).toBe(RiskBand.HIGH);
      expect(cancellation.outcome?.type).toBe(OutcomeType.HUMAN_RETENTION);
      expect(cancellation.outcome?.humanReason).toBe("high recurring value at high risk");
      // A prova de que a interceptacao aconteceu: HIGH sem alto valor teria criado oferta.
      expect(cancellation.outcome?.offer).toBeUndefined();
    });

    it("scenario-grey: zona cinzenta vai para retencao humana", async () => {
      const cancellation = await cancelar("scenario-grey");

      expect(cancellation.band).toBe(RiskBand.GREY);
      expect(cancellation.outcome?.type).toBe(OutcomeType.HUMAN_RETENTION);
      expect(cancellation.outcome?.humanReason).toBe("grey zone");
    });

    it("scenario-grey-high-value: Premium em zona cinzenta sai por `grey zone`, nao pelo valor", async () => {
      const cancellation = await cancelar("scenario-grey-high-value");

      expect(cancellation.outcome?.type).toBe(OutcomeType.HUMAN_RETENTION);
      expect(cancellation.outcome?.humanReason).toBe("grey zone");
    });

    it("scenario-high-value-low: Premium de baixo risco cancela direto", async () => {
      const cancellation = await cancelar("scenario-high-value-low");

      expect(cancellation.band).toBe(RiskBand.LOW);
      expect(cancellation.outcome?.type).toBe(OutcomeType.CANCELLED);
    });

    it("scenario-timeout: o deadline real corta e o caso vai para o humano, sem risco", async () => {
      // Lento de proposito (~3s): o agente nunca responde e quem decide e o relogio.
      const cancellation = await cancelar("scenario-timeout");

      expect(cancellation.risk).toBeUndefined();
      expect(cancellation.band).toBe(RiskBand.GREY);
      expect(cancellation.outcome?.type).toBe(OutcomeType.HUMAN_RETENTION);
      expect(cancellation.outcome?.humanReason).toBe("scoring agent timeout");
    }, 15_000);
  });

  describe("POST /cancellations: validacao e erros", () => {
    it("404 quando a assinatura nao existe", async () => {
      await request(server)
        .post("/cancellations")
        .send({
          subscriptionId: "01a0b1e9-0000-7000-8000-000000000000",
          rawReason: "x",
        })
        .expect(404);
    });

    it("400 quando o rawReason vem vazio", async () => {
      const scenario = scenarioById("scenario-low");

      await request(server)
        .post("/cancellations")
        .send({ subscriptionId: scenario.subscription.id, rawReason: "" })
        .expect(400);
    });

    it("400 quando o subscriptionId nao e UUID v7", async () => {
      await request(server)
        .post("/cancellations")
        .send({ subscriptionId: "550e8400-e29b-41d4-a716-446655440000", rawReason: "x" })
        .expect(400);
    });

    it("400 quando vem campo desconhecido no corpo", async () => {
      const scenario = scenarioById("scenario-low");

      await request(server)
        .post("/cancellations")
        .send({ subscriptionId: scenario.subscription.id, rawReason: "x", risk: 0.99 })
        .expect(400);
    });

    it("nao vaza stack trace no corpo de erro", async () => {
      const response = await request(server)
        .post("/cancellations")
        .send({ subscriptionId: "01a0b1e9-0000-7000-8000-000000000000", rawReason: "x" })
        .expect(404);

      expect(JSON.stringify(response.body)).not.toContain("at ");
      expect(response.body).not.toHaveProperty("stack");
    });
  });

  describe("GET /cancellations/:id", () => {
    it("devolve cancelamento, assinatura, assinante e plano", async () => {
      const criado = await cancelar("scenario-high");

      const response = await request(server).get(`/cancellations/${criado.id}`).expect(200);
      const body = response.body as CancellationDetailResponse;

      expect(Object.keys(body).sort()).toEqual([
        "cancellation",
        "plan",
        "subscriber",
        "subscription",
      ]);
      expect(body.cancellation.id).toBe(criado.id);
      expect(body.subscription.id).toBe(body.cancellation.subscriptionId);
      expect(body.subscriber.id).toBe(body.subscription.subscriberId);
      expect(body.plan.id).toBe(body.subscription.planId);
    });

    it("remonta o outcome com a oferta relacionada", async () => {
      const criado = await cancelar("scenario-high");

      const response = await request(server).get(`/cancellations/${criado.id}`).expect(200);
      const { cancellation } = response.body as CancellationDetailResponse;

      expect(cancellation.outcome?.type).toBe(OutcomeType.AUTOMATIC_OFFER);
      expect(cancellation.outcome?.offer?.cancellationId).toBe(criado.id);
    });

    it("404 quando o cancelamento nao existe", async () => {
      await request(server).get("/cancellations/01a0b1e9-0000-7000-8000-000000000000").expect(404);
    });

    it("400 quando o id nao e UUID v7", async () => {
      await request(server).get("/cancellations/nao-e-uuid").expect(400);
    });
  });
});
