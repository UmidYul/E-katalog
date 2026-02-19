import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 rounded-2xl border border-border p-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={`${r}-${c}`} className="h-8" />
          ))}
        </div>
      ))}
    </div>
  );
}
