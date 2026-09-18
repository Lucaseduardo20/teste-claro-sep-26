/**
 * Script de seed (`pnpm --filter @repo/backend db:seed`).
 *
 * É só a casca de linha de comando: abre a conexão, chama `seedScenarios` e fecha. A
 * lógica mora em `src/prisma/seed-scenarios.ts` porque a suíte e2e também precisa dela
 * para garantir os dados antes de bater nos endpoints.
 */
import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { resolveDatabaseUrl } from "../src/db/database-url";
import { seedScenarios } from "../src/prisma/seed-scenarios";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }),
});

try {
  console.info("seed concluido", await seedScenarios(prisma));
} finally {
  await prisma.$disconnect();
}
