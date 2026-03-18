import { Skeleton } from "@/components/ui/skeleton";

export function ProductPageSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)_240px]">
      <div className="space-y-3">
        <Skeleton className="h-[300px] w-full rounded-2xl" />
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-7 w-3/5" />
        <Skeleton className="h-24 rounded-xl" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-6 rounded-md" />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
