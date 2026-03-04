import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function Checkbox({
  checked,
  onCheckedChange,
  className,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-md border border-input bg-card transition focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/15 disabled:opacity-50",
        checked && "border-primary bg-primary text-primary-foreground",
        className
      )}
      aria-pressed={checked}
    >
      {checked ? <Check className="h-3.5 w-3.5" /> : null}
    </button>
  );
}
