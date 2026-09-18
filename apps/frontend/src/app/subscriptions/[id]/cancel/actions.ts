"use server";

import { isUUIDv7 } from "@repo/contracts";
import { redirect } from "next/navigation";

import { createCancellation } from "@/lib/api";

export interface CancelFormState {
  error?: string;
}

/**
 * Server Action do `POST /cancellations`.
 *
 * Roda no servidor, então a URL da API e o token (se um dia existir) nunca chegam ao
 * browser — o cliente só dispara a ação e espera. O `subscriptionId` chega por `bind`, e
 * não por campo escondido no formulário: campo escondido é editável por quem abrir o
 * DevTools, e aqui não há motivo para o id vir do cliente.
 *
 * Em caso de sucesso, `redirect` leva para a tela de resultado. `redirect` funciona
 * lançando uma exceção de controle do Next — por isso ele fica **fora** do `try`, senão o
 * `catch` engoliria o próprio redirecionamento e ele viraria uma mensagem de erro.
 */
export async function submitCancellation(
  subscriptionId: string,
  _previous: CancelFormState,
  formData: FormData,
): Promise<CancelFormState> {
  const rawReason = String(formData.get("rawReason") ?? "").trim();

  if (rawReason.length === 0) {
    return { error: "Conte pra gente o motivo antes de continuar." };
  }

  if (!isUUIDv7(subscriptionId)) {
    return { error: "Assinatura invalida. Volte e escolha de novo." };
  }

  let cancellationId: string;

  try {
    const { cancellation } = await createCancellation({ subscriptionId, rawReason });

    cancellationId = cancellation.id;
  } catch {
    return {
      error: "Nao conseguimos registrar seu cancelamento agora. Tente de novo em instantes.",
    };
  }

  redirect(`/cancellations/${cancellationId}`);
}
