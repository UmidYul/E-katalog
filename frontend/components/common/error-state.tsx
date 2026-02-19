import { AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const ErrorState = ({ title = "Request failed", message = "Please try again." }: { title?: string; message?: string }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-red-600">
        <AlertCircle className="h-4 w-4" />
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground">{message}</p>
    </CardContent>
  </Card>
);

