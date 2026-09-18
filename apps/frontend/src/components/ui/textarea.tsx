import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input bg-input/30 placeholder:text-muted-foreground focus-visible:border-ring",
        "focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        "field-sizing-content min-h-24 w-full rounded-2xl border px-3 py-2 text-sm",
        "outline-none transition-[color,box-shadow] focus-visible:ring-[3px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
