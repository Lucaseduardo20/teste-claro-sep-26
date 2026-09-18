import { OutcomeType } from "@repo/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, getCancellation } from "@/lib/api";
import { formatCents } from "@/lib/format";
import { outcomeCopy } from "@/lib/outcome-copy";

/**
 * Tela 4 — o resultado.
 *
 * Server Component: só leitura, sem interação. O `outcome` já vem decidido da API, e a
 * tela apenas traduz o desfecho para a língua do assinante (`@/lib/outcome-copy`) — que é
 * também onde está a regra de **nunca** mostrar o `humanReason` interno.
 */
export default async function CancellationResultPage(props: PageProps<"/cancellations/[id]">) {
  const { id } = await props.params;

  const detail = await getCancellation(id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();

    throw error;
  });

  const { cancellation, plan } = detail;
  const copy = outcomeCopy(cancellation.outcome);
  const offer = cancellation.outcome?.offer;

  return (
    <PageShell>
      <PageHeader eyebrow={copy.badge} title={copy.title} description={copy.description} />

      {cancellation.outcome?.type === OutcomeType.AUTOMATIC_OFFER && offer !== undefined ? (
        <Card>
          <CardHeader>
            <CardTitle>Sua oferta de retenção</CardTitle>
          </CardHeader>
          <CardContent>
            {offer.amountCents === undefined ? null : (
              <p className="text-3xl font-semibold tracking-tight">
                {formatCents(offer.amountCents)}
                <span className="text-muted-foreground ml-1 text-sm font-normal">
                  de desconto por mês
                </span>
              </p>
            )}
            <p className="text-muted-foreground text-sm text-pretty">
              No plano {plan.name}, você passaria a pagar{" "}
              <strong className="text-foreground">
                {formatCents(plan.priceCents - (offer.amountCents ?? 0))}
              </strong>{" "}
              por mês em vez de {formatCents(plan.priceCents)}.
            </p>
            {/* Aceitar e recusar sao os endpoints de stretch (POST /accept e /decline), que
                ficaram fora do escopo desta entrega. O botao desabilitado deixa o caminho
                visivel sem fingir que ele funciona. */}
            <div className="flex flex-wrap gap-3 pt-2">
              <Button disabled>Quero o desconto</Button>
              <Button variant="ghost" disabled>
                Seguir com o cancelamento
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              As ações da oferta ainda não estão disponíveis nesta versão.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Resumo da solicitação</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt className="text-muted-foreground">Plano</dt>
            <dd>
              {plan.name} · {formatCents(plan.priceCents)}/mês
            </dd>

            <dt className="text-muted-foreground">Motivo informado</dt>
            <dd className="text-pretty">{cancellation.rawReason}</dd>

            <dt className="text-muted-foreground">Protocolo</dt>
            <dd className="font-mono text-xs break-all">{cancellation.id}</dd>
          </dl>
        </CardContent>
      </Card>

      <div>
        <Button variant="outline" render={<Link href="/">Voltar para as assinaturas</Link>} />
      </div>
    </PageShell>
  );
}
