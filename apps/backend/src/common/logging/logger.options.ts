import type { Params } from "nestjs-pino";

/**
 * Configuração do logging estruturado (pino).
 *
 * Substitui o `AppLoggerMiddleware` do scaffold, que montava a linha de log à mão com
 * códigos de cor embutidos. A diferença prática: aquilo era uma string para humano lerem
 * no terminal; isto é JSON com campos, que uma ferramenta consegue filtrar por
 * `cancellationId`, agrupar por `event` ou alertar em cima de `scoring.timed_out`. O
 * `pino-http` já registra método, rota, status e duração de cada requisição, que era tudo
 * que o middleware fazia.
 *
 * Três ajustes por ambiente:
 *
 * - **teste**: silencioso. Log de 30 requisições no meio da saída do vitest só esconde a
 *   falha que interessa.
 * - **desenvolvimento**: `pino-pretty`, porque JSON cru no terminal é ilegível.
 * - **produção**: JSON puro, sem transport — é o formato que o coletor espera, e o
 *   transport custa uma worker thread.
 */
export function buildLoggerOptions(env = process.env): Params {
  const nodeEnv = env["NODE_ENV"];
  const isTest = nodeEnv === "test";
  const isProduction = nodeEnv === "production";

  return {
    pinoHttp: {
      level: env["LOG_LEVEL"] ?? (isTest ? "silent" : "info"),
      // Cabeçalhos de autenticação nunca entram no log, nem por acidente.
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['set-cookie']"],
      autoLogging: !isTest,
      ...(isProduction || isTest
        ? {}
        : { transport: { target: "pino-pretty", options: { singleLine: true } } }),
    },
  };
}
