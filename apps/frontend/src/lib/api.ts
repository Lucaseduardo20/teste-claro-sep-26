import "server-only";

import type {
  CancellationDetailResponse,
  CreateCancellationRequest,
  CreateCancellationResponse,
  SubscriptionListResponse,
} from "@repo/contracts";

/**
 * Cliente da API, **só no servidor**.
 *
 * Todas as leituras acontecem em Server Components e a escrita numa Server Action, então o
 * browser nunca fala com a API diretamente. O `server-only` no topo torna isso uma garantia
 * do compilador em vez de uma convenção: importar este arquivo de um componente cliente
 * quebra o build.
 *
 * A URL vem do ambiente, nunca do código. `API_URL` tem precedência sobre
 * `NEXT_PUBLIC_API_URL` porque em container os dois endereços são diferentes: o navegador
 * fala com `localhost:3000`, mas o container do frontend fala com `http://backend:3000`.
 */
function apiUrl(path: string): string {
  const base =
    process.env["API_URL"] ?? process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000";

  return new URL(path, base).toString();
}

/** Erro de API com o status preservado, para a página decidir entre 404 e 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  // `no-store`: os dados mudam a cada cancelamento, e uma lista em cache mostraria um
  // estado que já não existe. Nada aqui é conteúdo estático.
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new ApiError(response.status, `GET ${path} respondeu ${String(response.status)}`);
  }

  return (await response.json()) as T;
}

export async function listSubscriptions(): Promise<SubscriptionListResponse> {
  return get<SubscriptionListResponse>("/subscriptions");
}

export async function getCancellation(id: string): Promise<CancellationDetailResponse> {
  return get<CancellationDetailResponse>(`/cancellations/${id}`);
}

/**
 * Cria o cancelamento. É esta chamada que demora: do outro lado o Agente de Scoring roda
 * sob o deadline de 3s, e a resposta só vem quando a decisão existe.
 */
export async function createCancellation(
  body: CreateCancellationRequest,
): Promise<CreateCancellationResponse> {
  const response = await fetch(apiUrl("/cancellations"), {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new ApiError(response.status, `POST /cancellations respondeu ${String(response.status)}`);
  }

  return (await response.json()) as CreateCancellationResponse;
}
