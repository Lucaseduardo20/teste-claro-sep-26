import { Injectable } from "@nestjs/common";

import type { PlansRepository } from "@/plans/plans.repository";
import { PrismaService } from "@/prisma/prisma.service";

/** Adapter do `PlansRepository` sobre o Prisma. */
@Injectable()
export class PrismaPlansRepository implements PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  async distinctPriceCents(): Promise<number[]> {
    // Traduz para `SELECT DISTINCT price_cents FROM plans ORDER BY price_cents ASC`.
    const rows = await this.prisma.plan.findMany({
      distinct: ["priceCents"],
      select: { priceCents: true },
      orderBy: { priceCents: "asc" },
    });

    return rows.map((row) => row.priceCents);
  }
}
