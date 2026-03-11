import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/components/common/locale-provider";
import { formatColorValue } from "@/lib/utils/color-name";
import { formatSpecLabel, normalizeSpecsMap } from "@/lib/utils/specs";

export function SpecsTable({ specs }: { specs: Record<string, string | number | boolean> }) {
  const { locale } = useLocale();
  const rows = Object.entries(normalizeSpecsMap(specs)).sort(([left], [right]) => left.localeCompare(right));

  return (
    <Card className="rounded-xl border-border">
      <CardHeader>
        <CardTitle className="font-heading text-xl font-bold">{locale === "uz-Cyrl-UZ" ? "Нормаллаштирилган хусусиятлар" : "Нормализованные характеристики"}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {rows.length ? (
            rows.map(([key, value]) => (
              <div key={key} className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{formatSpecLabel(key, locale)}</span>
                <span className="font-medium">{key.toLowerCase().includes("color") ? formatColorValue(value) : String(value)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{locale === "uz-Cyrl-UZ" ? "Хусусиятлар ҳозирча мавжуд эмас." : "Характеристики пока отсутствуют."}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
