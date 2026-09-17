import { Module } from "@nestjs/common";

import { MockScoringAgent } from "@/scoring/mock-scoring-agent";
import { ScoringService } from "@/scoring/scoring.service";
import { SCORING_AGENT } from "@/scoring/scoring.tokens";

/**
 * Ports & Adapters, montado aqui.
 *
 * - **Port:** a interface `ScoringAgent`, que é da spec (`@repo/contracts`).
 * - **Adapter padrão:** `MockScoringAgent`, registrado no token `SCORING_AGENT`.
 * - **Consumidor:** `ScoringService`, que injeta o token e nunca soube qual
 *   implementação está atrás dele.
 *
 * Trocar o mock por um agente de LLM (stretch) é **uma linha, neste arquivo**:
 *
 * ```ts
 * { provide: SCORING_AGENT, useClass: OpenAIScoringAgent }
 * ```
 *
 * Nada mais muda — nem o `ScoringService`, nem o deadline, nem a regra de decisão, nem
 * os testes que não são do adapter. O deadline continua sendo aplicado por fora, o que é
 * ainda mais importante com um LLM real do que com o mock.
 *
 * O `useFactory` (em vez de `useClass`) é o que mantém o `MockScoringAgent` sem
 * `@Injectable()` e sem nenhum import do Nest: o adapter não precisa saber que existe um
 * container de DI para ser um adapter.
 *
 * O `SCORING_AGENT` também é exportado para que os testes possam substituí-lo por um
 * fake via `overrideProvider`, sem banco e sem LLM.
 */
@Module({
  providers: [{ provide: SCORING_AGENT, useFactory: () => new MockScoringAgent() }, ScoringService],
  exports: [ScoringService, SCORING_AGENT],
})
export class ScoringModule {}
