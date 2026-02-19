import { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export const Table = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className="w-full overflow-x-auto rounded-2xl border border-border">
    <table className={cn("w-full caption-bottom text-sm", className)}>{children}</table>
  </div>
);

export const TableHeader = ({ children }: { children: ReactNode }) => <thead className="bg-secondary/50">{children}</thead>;
export const TableBody = ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>;
export const TableRow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <tr className={cn("border-t border-border", className)}>{children}</tr>
);
export const TableHead = ({ children, className }: { children: ReactNode; className?: string }) => (
  <th className={cn("px-4 py-3 text-left font-medium text-muted-foreground", className)}>{children}</th>
);
export const TableCell = ({ children, className }: { children: ReactNode; className?: string }) => (
  <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>
);
