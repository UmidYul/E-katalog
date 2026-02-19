import { cn } from "@/lib/utils/cn";

export function RadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onValueChange(option.value)}
            className={cn(
              "rounded-xl border px-3 py-1.5 text-sm transition",
              checked ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-secondary"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
