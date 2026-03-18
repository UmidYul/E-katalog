import { SearchX } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export const EmptyState = ({
  title,
  message,
  description,
  icon,
  action,
}: {
  title: string;
  message?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      {icon ?? <SearchX className="h-6 w-6 text-muted-foreground" />}
      <h3 className="text-base font-semibold">{title}</h3>
      {description || message ? <p className="max-w-md text-sm text-muted-foreground">{description ?? message}</p> : null}
      {action ?? null}
    </CardContent>
  </Card>
);

