import { Inject, Injectable, Logger } from "@nestjs/common";
import { SCORING_TIMEOUT_MS, type ScoringAgent, type ScoringInput } from "@repo/contracts";

import { SCORING_AGENT } from "@/scoring/scoring.tokens";
import { withDeadline } from "@/scoring/with-deadline";

/**
 * Saída do scoring já com o deadline aplicado.
 *
 * **Por que não devolver o `ScoringResult` do contracts.** `ScoringResult.risk` é
 * obrigatório (`risk: number`), então aquele tipo não consegue representar o estado
 * "estourou o prazo e não há risco nenhum". Preencher com zero seria inventar número — e
 * zero é o risco *mais baixo possível*, que levaria a regra a `CANCELLED`, o oposto do
 * que a spec manda no timeout. (Anotei essa tensão da spec no DECISIONS.md.)
 *
 * A união discriminada resolve, e não por acaso ela tem a mesma forma da `DecisionInput`
 * da Tarefa 02: o encaixe entre as duas camadas é direto, sem adaptação forçada.
 */
export type ScoringOutcome =
  | { timedOut: false; risk: number; rationale?: string | undefined; latencyMs: number }
  | { timedOut: true; latencyMs: number };

/**
 * Orquestra uma chamada ao Agente de Scoring sob prazo.
 *
 * A divisão de responsabilidade é o ponto: o **agente** (adapter) só sabe produzir um
 * risco e demorar o que demorar; o **service** é quem sabe que existe um orçamento de
 * tempo e o que fazer quando ele acaba. Por isso o deadline está aqui e não no mock — se
 * estivesse lá dentro, cada implementação futura do port teria que reimplementar a mesma
 * política, e um adapter de LLM poderia "esquecer" dela.
 *
 * O agente chega por injeção do token `SCORING_AGENT`. Este service nunca soube qual
 * implementação está do outro lado, e é por isso que trocar o mock por um
 * `OpenAIScoringAgent` não encosta nesta classe.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(@Inject(SCORING_AGENT) private readonly agent: ScoringAgent) {}

  async score(input: ScoringInput): Promise<ScoringOutcome> {
    const raced = await withDeadline(this.agent.score(input), SCORING_TIMEOUT_MS);

    if (raced.timedOut) {
      this.logger.warn(
        `Agente de Scoring estourou ${SCORING_TIMEOUT_MS}ms na assinatura ${input.subscription.id}`,
      );

      // `latencyMs` aqui é o orçamento gasto, não uma medição: esperamos o prazo inteiro
      // e desistimos. Quanto o agente ainda levaria é justamente o que não se sabe.
      return { timedOut: true, latencyMs: SCORING_TIMEOUT_MS };
    }

    const { risk, rationale, latencyMs } = raced.value;

    // `latencyMs` vem do agente — é a latência que ele *simula*, não o tempo de parede
    // que este service mediu. Ver a justificativa no DECISIONS.md.
    return { timedOut: false, risk, rationale, latencyMs };
  }
}
