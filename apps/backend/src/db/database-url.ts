/**
 * Fonte única da string de conexão do Postgres.
 *
 * Existia duplicada em três lugares (`db.module.ts`, `prisma.config.ts`, `prisma/seed.ts`);
 * a dívida está registrada no DECISIONS.md da Tarefa 01 e é paga aqui, agora que o
 * `PrismaService` entrou e seria o quarto.
 *
 * O fallback é o mesmo que o `.env.example` promete: sem `.env`, os defaults batem com o
 * docker compose. É isso que mantém `prisma generate` e um clone limpo funcionando antes
 * de alguém copiar o arquivo de ambiente.
 */
export const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/smart_retention";

export function resolveDatabaseUrl(): string {
  return process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL;
}
