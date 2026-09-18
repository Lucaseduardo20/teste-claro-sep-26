import { notFound } from "next/navigation";

import { PageHeader, PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listSubscriptions } from "@/lib/api";
import { formatCents } from "@/lib/format";

import { CancelForm } from "./cancel-form";

/**
 * Tela 2 — motivo do cancelamento.
 *
 * A página é Server Component (busca os dados da assinatura para mostrar o que está sendo
 * cancelado) e delega só o formulário ao cliente.
 *
 * Nota de escopo: a API do núcleo não tem `GET /subscriptions/:id`, então a assinatura sai
 * da lista. Com 7 linhas isso é irrelevante; num catálogo grande o certo seria um endpoint
 * dedicado — mas inventar endpoint fora do escopo dos três de núcleo seria pior.
 */
export default async function CancelSubscriptionPage(
  props: PageProps<"/subscriptions/[id]/cancel">,
) {
  const { id } = await props.params;
  const { subscriptions } = await listSubscriptions();
  const item = subscriptions.find(({ subscription }) => subscription.id === id);

  if (item === undefined) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cancelamento"
        title="Antes de cancelar, nos conte o motivo"
        description="Leva menos de um minuto e pode mudar o que a gente oferece pra você."
      />

      <Card>
        <CardHeader>
          <CardTitle>Plano {item.plan.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Assinante: {item.subscriber.name} · {formatCents(item.plan.priceCents)}/mês
          </p>
        </CardContent>
      </Card>

      <CancelForm subscriptionId={id} />
    </PageShell>
  );
}
