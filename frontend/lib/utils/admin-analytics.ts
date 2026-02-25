import type { AdminAlertEvent, AlertSource, AlertStatus, Severity } from "@/types/admin";

export type AlertFilter = {
  status?: AlertStatus | "all";
  severity?: Severity | "all";
  source?: AlertSource | "all";
};

export function filterAlertEvents(items: AdminAlertEvent[], filter: AlertFilter): AdminAlertEvent[] {
  return items.filter((item) => {
    if (filter.status && filter.status !== "all" && item.status !== filter.status) return false;
    if (filter.severity && filter.severity !== "all" && item.severity !== filter.severity) return false;
    if (filter.source && filter.source !== "all" && item.source !== filter.source) return false;
    return true;
  });
}

export function toDonutRows(
  rows: Array<{ name: string; value: number }>,
  palette: string[],
): Array<{ name: string; value: number; color: string }> {
  return rows.map((row, index) => ({
    ...row,
    color: palette[index % palette.length] ?? "#64748b",
  }));
}
