import Link from "next/link";

import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { listSubscriptions } from "@/lib/api";
import { formatCents } from "@/lib/format";

/**
 * Tela 1 — as assinaturas do assinante.
 *
 * Server Component: os dados vêm de `GET /subscriptions` direto no servidor, então o HTML
 * já chega pronto e a API nunca é exposta ao browser. Não há estado nem interação nesta
 * tela — só leitura e um link por assinatura —, que é exatamente o caso em que um
 * componente cliente não acrescentaria nada além de JavaScript no bundle.
 */
export default async function SubscriptionsPage() {
  const { subscriptions } = await listSubscriptions();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Minha conta"
        title="Suas assinaturas"
        description="Escolha a assinatura que você quer cancelar."
      />

      {subscriptions.length === 0 ? (
        <p className="text-muted-foreground">Você não tem assinaturas ativas no momento.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {subscriptions.map(({ subscription, subscriber, plan }) => (
            <li key={subscription.id}>
              <Card>
                <CardHeader>
                  <CardTitle>Plano {plan.name}</CardTitle>
                  <p className="text-muted-foreground text-sm">Assinante: {subscriber.name}</p>
                </CardHeader>

                <CardContent>
                  <p className="text-2xl font-semibold tracking-tight">
                    {formatCents(plan.priceCents)}
                    <span className="text-muted-foreground ml-1 text-sm font-normal">/mês</span>
                  </p>
                  <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {plan.benefits.map((benefit) => (
                      <li key={benefit}>{benefit}</li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter>
                  {/* `String(id)` porque o id do contracts e um tipo *branded* (UUIDv7) e o
                      typedRoutes do Next so infere a rota a partir de `string` puro. A
                      interpolacao fica inline: extrair para uma const alargaria o tipo para
                      `string` e a rota deixaria de ser verificada. */}
                  <Button
                    variant="outline"
                    render={
                      <Link href={`/subscriptions/${String(subscription.id)}/cancel`}>
                        <span aria-hidden="true">Cancelar assinatura</span>
                        {/* Numa lista de varios botoes iguais, o leitor de tela precisa
                            distinguir de qual assinatura e cada um. */}
                        <span className="sr-only">Cancelar assinatura do plano {plan.name}</span>
                      </Link>
                    }
                  />
                </CardFooter>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
