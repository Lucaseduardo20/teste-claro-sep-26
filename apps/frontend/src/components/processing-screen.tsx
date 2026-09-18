/**
 * Tela 3 — "Analisando sua solicitação".
 *
 * Esta espera é **real**, e é por isso que a tela existe. Do outro lado, o `POST
 * /cancellations` só responde depois que o Agente de Scoring devolve o risco (latência
 * simulada de 200 a 1500ms) ou que o deadline de 3s estoura. Não há `setTimeout` fingindo
 * trabalho aqui: o componente fica no ar exatamente enquanto a decisão está sendo tomada.
 *
 * `role="status"` com `aria-live="polite"`: quem usa leitor de tela é avisado de que algo
 * está acontecendo, sem que o anúncio interrompa o que estiver sendo lido.
 *
 * Não renderiza `<main>` de propósito. Ele aparece em dois contextos — dentro do
 * formulário da Tela 2 (que já está num `<main>`) e no `loading.tsx` da Tela 4 (que
 * precisa de um) — e um `<main>` aninhado dentro de outro é HTML inválido e dois marcos de
 * navegação para quem usa leitor de tela. Quem monta a moldura é o chamador.
 */
export function ProcessingScreen({ title = "Analisando sua solicitação" }: { title?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <span
        aria-hidden="true"
        className="border-muted border-t-primary size-10 animate-spin rounded-full border-4"
      />
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground max-w-sm text-pretty">
        Estamos avaliando o seu pedido de cancelamento para ver se conseguimos fazer algo por você.
        Isso leva só alguns segundos.
      </p>
    </div>
  );
}
