import { PageShell } from "@/components/page-shell";
import { ProcessingScreen } from "@/components/processing-screen";

/**
 * Tela 3, segunda metade.
 *
 * O App Router embrulha esta rota num `<Suspense>` automaticamente e mostra isto enquanto
 * o Server Component do resultado busca `GET /cancellations/:id`. Junto com o `isPending`
 * do formulário, o assinante vê uma tela de processamento contínua do clique até o
 * resultado — sem o "branco" entre a ação terminar e a próxima página renderizar.
 */
export default function Loading() {
  return (
    <PageShell>
      <ProcessingScreen title="Preparando seu resultado" />
    </PageShell>
  );
}
