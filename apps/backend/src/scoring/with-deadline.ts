/**
 * Resultado de uma corrida contra o relógio. União discriminada pelo mesmo motivo da
 * `DecisionInput` da Tarefa 02: quando o deadline vence, **não existe valor** — e não
 * existir é diferente de ser vazio. O compilador só libera `.value` depois que o código
 * prova que a operação ganhou.
 */
export type DeadlineResult<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Corre `operation` contra um relógio de `deadlineMs` e devolve quem ganhou.
 *
 * ## Por que `Promise.race` e não um "timeout" dentro da operação
 *
 * A operação não é cancelável — uma chamada de LLM já saiu pela rede, um `setTimeout` já
 * está agendado. `Promise.race` não cancela ninguém: ele decide **de quem a gente vai
 * ouvir a resposta**. O perdedor continua correndo em segundo plano até terminar
 * sozinho, e o resultado dele é descartado. É exatamente a semântica que um deadline de
 * atendimento quer: "passou do tempo, eu sigo sem você".
 *
 * Isso é o que torna o caminho *real*. A operação de fato demora; o relógio de fato
 * dispara; a corrida de fato acontece. Uma flag `simulateTimeout` devolvida na hora
 * testaria o `if` que lê a flag, não o mecanismo.
 *
 * ## O vazamento que esta função fecha: o timer
 *
 * Se a operação responde primeiro e ninguém chama `clearTimeout`, o `setTimeout`
 * continua agendado até o fim do prazo. Num processo isso é memória retida a cada
 * chamada; num teste é pior — o Node mantém o event loop vivo enquanto houver timer
 * pendente, e a suíte fica travada esperando um relógio que não interessa mais. O
 * `finally` limpa nos três desfechos: operação ganhou, deadline ganhou, operação falhou.
 *
 * ## O vazamento que **não** precisa ser fechado aqui
 *
 * O reflexo seguinte seria proteger contra a *rejeição tardia*: se o deadline ganha e a
 * operação rejeita depois, aquela promessa perdedora viraria `unhandledRejection` — que
 * no Node moderno derruba o processo. Cheguei a escrever um `operation.catch(() => {})`
 * para isso e depois **testei sem ele**: o teste continua passando. O motivo é que
 * `Promise.race` anexa um handler a *todas* as promessas que recebe, e esse handler
 * continua lá depois da corrida decidida. A rejeição tardia já é observada. O `.catch()`
 * extra seria código morto se passando por proteção, então saiu.
 *
 * Erro da operação **não** é timeout: a rejeição se propaga para o chamador, que assim
 * consegue distinguir "o agente falhou" de "o agente demorou".
 *
 * Função genérica e pura em relação a framework: serve o Agente de Scoring hoje e o de
 * Classificação depois.
 */
export async function withDeadline<T>(
  operation: Promise<T>,
  deadlineMs: number,
): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ timedOut: true });
    }, deadlineMs);
  });

  try {
    return await Promise.race([
      operation.then((value): DeadlineResult<T> => ({ timedOut: false, value })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
