import type {
  Cancellation,
  OfferStatus,
  OfferType,
  OutcomeType,
  Plan,
  RiskBand,
  Subscriber,
  Subscription,
  UUIDv7,
} from "@repo/contracts";

export const CANCELLATIONS_REPOSITORY = Symbol("CANCELLATIONS_REPOSITORY");

/** Cancelamento "nu": o que se sabe antes de qualquer agente rodar. */
export interface PendingCancellation {
  id: UUIDv7;
  subscriptionId: UUIDv7;
  rawReason: string;
}

/** A decisão a ser gravada, com a oferta quando o caminho é `AUTOMATIC_OFFER`. */
export interface CancellationDecision {
  id: UUIDv7;
  risk?: number | undefined;
  band: RiskBand;
  outcomeType: OutcomeType;
  humanReason?: string | undefined;
  offer?: { id: UUIDv7; type: OfferType; status: OfferStatus; amountCents: number } | undefined;
}

/** Resposta de `GET /cancellations/:id`. */
export interface CancellationDetail {
  cancellation: Cancellation;
  subscription: Subscription;
  subscriber: Subscriber;
  plan: Plan;
}

export interface CancellationsRepository {
  /** Grava o cancelamento antes de decidir. `risk`, `band` e outcome ficam NULL. */
  createPending(pending: PendingCancellation): Promise<Cancellation>;

  /**
   * Grava a decisão e, se houver, a oferta — **numa transação só**.
   *
   * A atomicidade é requisito, não detalhe: um cancelamento com
   * `outcome_type = AUTOMATIC_OFFER` e sem linha em `offers` é um estado que a spec não
   * prevê, e a tela de resultado não teria o que mostrar.
   */
  applyDecision(decision: CancellationDecision): Promise<Cancellation>;

  findDetail(cancellationId: UUIDv7): Promise<CancellationDetail | null>;
}
