import { SearchX } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export const EmptyState = ({ title, message }: { title: string; message: string }) => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
      <SearchX className="h-6 w-6 text-muted-foreground" />
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
    </CardContent>
  </Card>
);

