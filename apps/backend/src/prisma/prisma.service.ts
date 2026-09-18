import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { resolveDatabaseUrl } from "@/db/database-url";

/**
 * `PrismaClient` como provider do Nest, com ciclo de vida amarrado ao da aplicação.
 *
 * No Prisma 7 o client exige um *driver adapter*; o `PrismaPg` reaproveita o driver `pg`
 * que já era dependência do projeto, então não há dois pools de conexão concorrendo.
 *
 * O `connect()` no `onModuleInit` é deliberadamente tolerante: a API sobe mesmo com o
 * banco parado, como o `/health` do scaffold já prometia (`{"db":"down"}`). Derrubar o
 * boot por causa do Postgres transformaria uma indisponibilidade temporária em uma
 * aplicação que não volta sozinha.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.warn(`Postgres indisponivel no boot: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
