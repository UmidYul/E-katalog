import { cn } from "@/lib/utils/cn";

export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  if (src) {
    return <img src={src} alt={name} className={cn("h-9 w-9 rounded-xl object-cover", className)} />;
  }
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
  return (
    <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-xs font-semibold text-primary", className)}>
      {initials || "U"}
    </div>
  );
}
