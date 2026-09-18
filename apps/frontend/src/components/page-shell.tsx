import { cn } from "@/lib/utils";

/** Moldura comum das quatro telas: largura, respiro e o `<main>` de marco da pagina. */
export function PageShell({ className, children }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn("mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12", className)}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="space-y-2">
      {eyebrow === undefined ? null : (
        <p className="text-muted-foreground text-sm font-medium">{eyebrow}</p>
      )}
      <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      {description === undefined ? null : (
        <p className="text-muted-foreground text-pretty">{description}</p>
      )}
    </header>
  );
}
