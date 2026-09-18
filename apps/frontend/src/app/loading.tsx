import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Estado de carregamento da lista, enquanto o Server Component busca as assinaturas. */
export default function Loading() {
  return (
    <PageShell>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Carregando suas assinaturas
      </span>
    </PageShell>
  );
}
