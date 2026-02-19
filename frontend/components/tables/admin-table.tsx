"use client";

import { ArrowDownUp } from "lucide-react";
import { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type AdminColumn<T> = {
  key: string;
  title: string;
  sortable?: boolean;
  render: (item: T) => ReactNode;
  className?: string;
};

export function AdminTable<T>({
  data,
  columns,
  sort,
  onSort,
}: {
  data: T[];
  columns: AdminColumn<T>[];
  sort?: string;
  onSort?: (field: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={col.className}>
              {col.sortable ? (
                <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1" onClick={() => onSort?.(col.key)}>
                  {col.title}
                  <ArrowDownUp className={`h-3.5 w-3.5 ${sort === col.key ? "text-primary" : "text-muted-foreground"}`} />
                </Button>
              ) : (
                col.title
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((item, index) => (
          <TableRow key={index}>
            {columns.map((col) => (
              <TableCell key={`${col.key}-${index}`} className={col.className}>
                {col.render(item)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
