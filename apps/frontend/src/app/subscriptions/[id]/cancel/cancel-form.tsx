"use client";

import Link from "next/link";
import { useActionState } from "react";

import { ProcessingScreen } from "@/components/processing-screen";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { submitCancellation, type CancelFormState } from "./actions";

const ESTADO_INICIAL: CancelFormState = {};

/**
 * Tela 2 — o motivo, e a única parte cliente do fluxo.
 *
 * É componente cliente porque precisa de duas coisas que só existem no browser: o estado
 * de envio (`isPending`, que vira a Tela 3) e a mensagem de erro devolvida pela ação sem
 * recarregar a página. Todo o resto do fluxo é Server Component.
 *
 * `useActionState` é o que dá o `isPending` de graça, e ele é **honesto**: fica `true`
 * exatamente enquanto a Server Action está rodando — ou seja, enquanto o Agente de Scoring
 * está pensando do outro lado.
 */
export function CancelForm({ subscriptionId }: { subscriptionId: string }) {
  const [state, formAction, isPending] = useActionState(
    submitCancellation.bind(null, subscriptionId),
    ESTADO_INICIAL,
  );

  if (isPending) return <ProcessingScreen />;

  const erroId = "motivo-erro";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="rawReason">Por que você quer cancelar?</Label>
        <Textarea
          id="rawReason"
          name="rawReason"
          required
          autoFocus
          placeholder="Escreva com suas palavras. Por exemplo: está caro, não estou usando, tive um problema técnico…"
          aria-describedby={state.error === undefined ? undefined : erroId}
          aria-invalid={state.error === undefined ? undefined : true}
        />
        <p className="text-muted-foreground text-sm">
          Sua resposta ajuda a gente a entender o que pode melhorar.
        </p>
      </div>

      {state.error === undefined ? null : (
        <p id={erroId} role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit">Continuar</Button>
        <Button variant="ghost" render={<Link href="/">Voltar</Link>} />
      </div>
    </form>
  );
}
