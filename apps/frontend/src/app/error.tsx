"use client";

import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

/**
 * Fronteira de erro do App Router — precisa ser componente cliente.
 *
 * Mostra uma mensagem humana e um caminho de saída. O detalhe técnico fica no `digest`,
 * que o Next registra no servidor: pela mesma razão do exception filter do backend, a tela
 * não expõe a mensagem crua do erro.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageShell className="justify-center">
      <PageHeader
        title="Algo deu errado por aqui"
        description="Não conseguimos carregar esta página. Tente de novo em instantes."
      />
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Tentar de novo</Button>
      </div>
      {error.digest === undefined ? null : (
        <p className="text-muted-foreground font-mono text-xs">Referência: {error.digest}</p>
      )}
    </PageShell>
  );
}
