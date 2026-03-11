import { TrendingDown, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/components/common/locale-provider";
import type { PriceAlertSignal } from "@/types/domain";

export function PriceAlertBadge({ signal }: { signal?: PriceAlertSignal | null }) {
  const t = useT("product");
  if (!signal?.is_drop && !signal?.is_target_hit) return null;

  if (signal.is_target_hit) {
    return (
      <Badge className="gap-1 border-success/40 bg-success/15 text-success">
        <Target className="h-3.5 w-3.5" /> {t("targetReached")}
      </Badge>
    );
  }

  return (
    <Badge className="gap-1 border-warning/50 bg-warning/15 text-warning">
      <TrendingDown className="h-3.5 w-3.5" /> {t("priceDropped")}
    </Badge>
  );
}
