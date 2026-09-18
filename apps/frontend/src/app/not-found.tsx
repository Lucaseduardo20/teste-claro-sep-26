import Link from "next/link";

import { PageHeader, PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageShell className="justify-center">
      <PageHeader
        title="Não encontramos essa página"
        description="O endereço pode estar errado, ou o que você procura não existe mais."
      />
      <div>
        <Button render={<Link href="/">Voltar para as assinaturas</Link>} />
      </div>
    </PageShell>
  );
}
