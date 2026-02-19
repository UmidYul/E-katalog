import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SpecsTable({ specs }: { specs: Record<string, string | number | boolean> }) {
  const rows = Object.entries(specs);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI-normalized specifications</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {rows.length ? (
            rows.map(([key, value]) => (
              <div key={key} className="grid grid-cols-2 gap-2 rounded-xl border border-border/70 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{key}</span>
                <span className="font-medium">{String(value)}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No specs available.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

