// Configuração do Prisma CLI (generate, migrate, db seed).
//
// No Prisma 7 a URL de conexão saiu do `schema.prisma` e passou a morar aqui. O
// `dotenv/config` carrega `apps/backend/.env`, então `DATABASE_URL` continua sendo a
// única fonte da string de conexão — para o CLI e para o app.
import "dotenv/config";

import { defineConfig } from "prisma/config";

// Mesmo fallback de `src/db/db.module.ts`: sem `.env`, os defaults batem com o
// docker compose. Isso mantém `prisma generate` (que nem abre conexão) rodando em
// clone limpo, antes de alguém copiar o `.env.example`.
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/smart_retention";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // O seed roda em TypeScript para consumir `@repo/contracts` com tipos.
    seed: "pnpm exec tsx prisma/seed.ts",
  },
  datasource: {
    url: DATABASE_URL,
  },
});
