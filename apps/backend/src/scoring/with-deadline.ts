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
 * ## Os dois vazamentos que esta função fecha
 *
 * 1. **O timer.** Se a operação responde primeiro e ninguém chama `clearTimeout`, o
 *    `setTimeout` continua agendado até o fim do prazo. Num processo isso é memória
 *    retida a cada chamada; num teste é pior — o Node mantém o event loop vivo enquanto
 *    houver timer pendente, e a suíte trava esperando um relógio que não interessa mais.
 *    O `finally` limpa nos três desfechos (operação ganhou, deadline ganhou, operação
 *    falhou).
 *
 * 2. **A rejeição tardia.** Se o deadline ganha e a operação rejeita *depois*, ninguém
 *    está mais ouvindo aquela promessa: vira `unhandledRejection`, que no Node moderno
 *    derruba o processo. O `.catch()` registrado antes da corrida é um ouvinte
 *    silencioso que existe só para isso. Ele não engole erro nenhum do caminho normal —
 *    a corrida tem o seu próprio ramo de rejeição, logo abaixo.
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

  // Ouvinte silencioso: cobre o caso de a operação rejeitar depois de já ter perdido a
  // corrida. Sem ele, a rejeição ficaria sem tratamento e derrubaria o processo.
  operation.catch(() => undefined);

  try {
    return await Promise.race([
      operation.then((value): DeadlineResult<T> => ({ timedOut: false, value })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
