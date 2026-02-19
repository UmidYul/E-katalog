import { cn } from "@/lib/utils/cn";

export function MiniBarChart({ data, className }: { data: Array<{ label: string; value: number }>; className?: string }) {
  const max = Math.max(...data.map((x) => x.value), 1);
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-4", className)}>
      <div className="flex h-44 items-end gap-2">
        {data.map((item) => (
          <div key={item.label} className="flex flex-1 flex-col items-center gap-2">
            <div
              className="w-full rounded-xl bg-primary/80 transition-all"
              style={{ height: `${Math.max((item.value / max) * 100, 6)}%` }}
            />
            <span className="text-[11px] text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
