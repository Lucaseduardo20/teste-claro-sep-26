/**
 * Erros de domínio — sem nenhuma noção de HTTP.
 *
 * O use case não lança `NotFoundException` do Nest de propósito: ele não deveria saber que
 * existe um protocolo HTTP do outro lado. Quem traduz domínio → status code é o
 * `AllExceptionsFilter`, na borda. Assim o mesmo use case serve um controller REST hoje e
 * um consumidor de fila amanhã, sem que "não encontrei" vire "404" no lugar errado.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A assinatura informada no cancelamento não existe. */
export class SubscriptionNotFoundError extends DomainError {
  constructor(readonly subscriptionId: string) {
    super(`Assinatura ${subscriptionId} nao encontrada`);
  }
}

/** O cancelamento pedido em `GET /cancellations/:id` não existe. */
export class CancellationNotFoundError extends DomainError {
  constructor(readonly cancellationId: string) {
    super(`Cancelamento ${cancellationId} nao encontrado`);
  }
}
