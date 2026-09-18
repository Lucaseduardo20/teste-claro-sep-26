import { Injectable } from "@nestjs/common";
import type { Cancellation, UUIDv7 } from "@repo/contracts";

import type {
  CancellationDecision,
  CancellationDetail,
  CancellationsRepository,
  PendingCancellation,
} from "@/cancellations/cancellations.repository";
import { toCancellation, toPlan, toSubscriber, toSubscription } from "@/persistence/domain-mapper";
import { PrismaService } from "@/prisma/prisma.service";

@Injectable()
export class PrismaCancellationsRepository implements CancellationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(pending: PendingCancellation): Promise<Cancellation> {
    // Só os três campos que existem neste instante. `risk`, `band`, `outcome_type`,
    // `human_reason` e `reason_category` ficam NULL — os nullables sem default da Tarefa 01
    // existem exatamente para representar este estado.
    const row = await this.prisma.cancellation.create({
      data: {
        id: pending.id,
        subscriptionId: pending.subscriptionId,
        rawReason: pending.rawReason,
      },
    });

    return toCancellation(row);
  }

  async applyDecision(decision: CancellationDecision): Promise<Cancellation> {
    const { id, risk, band, outcomeType, humanReason, offer } = decision;

    // `$transaction` com callback: o update e a criação da oferta ou acontecem juntos, ou
    // nenhum dos dois. Sem isso, uma falha entre as duas escritas deixaria um cancelamento
    // dizendo "tem oferta" sem oferta nenhuma no banco.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.cancellation.update({
        where: { id },
        data: {
          risk: risk ?? null,
          band,
          outcomeType,
          humanReason: humanReason ?? null,
          updatedAt: new Date(),
        },
      });

      if (offer !== undefined) {
        await tx.offer.create({
          data: {
            id: offer.id,
            cancellationId: id,
            type: offer.type,
            status: offer.status,
            amountCents: offer.amountCents,
          },
        });
      }

      return tx.cancellation.findUniqueOrThrow({ where: { id }, include: { offer: true } });
    });

    return toCancellation(row);
  }

  async findDetail(cancellationId: UUIDv7): Promise<CancellationDetail | null> {
    // Uma consulta só: cancelamento + oferta + assinatura + assinante + plano.
    const row = await this.prisma.cancellation.findUnique({
      where: { id: cancellationId },
      include: {
        offer: true,
        subscription: { include: { subscriber: true, plan: true } },
      },
    });

    if (row === null) return null;

    return {
      cancellation: toCancellation(row),
      subscription: toSubscription(row.subscription),
      subscriber: toSubscriber(row.subscription.subscriber),
      plan: toPlan(row.subscription.plan),
    };
  }
}
