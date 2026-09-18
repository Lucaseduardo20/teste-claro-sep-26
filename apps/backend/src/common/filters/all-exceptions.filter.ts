import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import {
  CancellationNotFoundError,
  SubscriptionNotFoundError,
} from "@/common/errors/domain-errors";

/** Corpo de erro padronizado da API. */
interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * Traduz qualquer exceção em uma resposta HTTP coerente.
 *
 * Três caminhos, e a diferença entre eles é o que importa:
 *
 * 1. **Erro de domínio** (`SubscriptionNotFoundError`, `CancellationNotFoundError`) → 404.
 *    É aqui que "não encontrei" vira um status. O use case não sabe o que é HTTP e não
 *    deveria saber — ver `common/errors/domain-errors.ts`.
 * 2. **`HttpException`** (validação do `ValidationPipe`, `BadRequestException` dos pipes)
 *    → passa o próprio status e mensagem adiante, preservando a lista de erros de campo
 *    que o class-validator produz.
 * 3. **Qualquer outra coisa** → 500 com mensagem genérica. **A exceção original é logada
 *    com stack**, mas o cliente recebe só "Erro interno". Vazar stack trace numa resposta
 *    entrega caminho de arquivo, versão de dependência e estrutura interna a quem estiver
 *    sondando.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const body = this.describe(exception, request.originalUrl);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        { event: "request.failed", path: body.path, err: exception },
        "Erro nao tratado",
      );
    } else {
      this.logger.warn(
        { event: "request.rejected", path: body.path, statusCode: body.statusCode },
        typeof body.message === "string" ? body.message : body.message.join("; "),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private describe(exception: unknown, path: string): ErrorBody {
    const timestamp = new Date().toISOString();

    if (
      exception instanceof SubscriptionNotFoundError ||
      exception instanceof CancellationNotFoundError
    ) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        error: "Not Found",
        message: exception.message,
        path,
        timestamp,
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const status = exception.getStatus();

      return {
        statusCode: status,
        error: statusLabel(status),
        message: extractMessage(payload, exception.message),
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: "Internal Server Error",
      // Genérica de propósito: o detalhe fica no log, não na resposta.
      message: "Erro interno",
      path,
      timestamp,
    };
  }
}

/** `BAD_REQUEST` -> `Bad Request`, para o corpo de erro falar a lingua do HTTP. */
function statusLabel(status: number): string {
  const name: string | undefined = HttpStatus[status];

  if (name === undefined) return "Error";

  return name
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

/** Preserva a lista de erros de campo do class-validator, quando houver. */
function extractMessage(payload: string | object, fallback: string): string | string[] {
  if (typeof payload === "string") return payload;

  if ("message" in payload) {
    const { message } = payload as { message: unknown };

    if (typeof message === "string") return message;
    if (Array.isArray(message) && message.every((item) => typeof item === "string")) return message;
  }

  return fallback;
}
