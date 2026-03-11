"use client";

import { AlertCircle } from "lucide-react";

import { useLocale } from "@/components/common/locale-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const ErrorState = ({ title, message }: { title?: string; message?: string }) => {
  const { locale } = useLocale();
  const fallbackTitle = locale === "uz-Cyrl-UZ" ? "Сўров хатоси" : "Ошибка запроса";
  const fallbackMessage = locale === "uz-Cyrl-UZ" ? "Илтимос, яна уриниб кўринг." : "Попробуйте ещё раз.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          {title ?? fallbackTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{message ?? fallbackMessage}</p>
      </CardContent>
    </Card>
  );
};

