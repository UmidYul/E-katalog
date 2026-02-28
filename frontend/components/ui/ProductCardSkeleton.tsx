import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
  return (
    <div className="card-base card-hover flex h-full flex-col animate-pulse">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="space-y-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
    </div>
  );
}

