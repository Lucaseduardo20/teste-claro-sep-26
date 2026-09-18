import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";

import { resolveDatabaseUrl } from "@/db/database-url";

export const DB_POOL = Symbol("DB_POOL");

/** O pool não impede o boot quando o banco está indisponível. */
const pool = new Pool({
  connectionString: resolveDatabaseUrl(),
  max: 10,
  connectionTimeoutMillis: 2000,
});

/** Pool de `pg` disponível por injeção de dependência. */
@Global()
@Module({
  providers: [{ provide: DB_POOL, useValue: pool }],
  exports: [DB_POOL],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await pool.end();
  }
}
