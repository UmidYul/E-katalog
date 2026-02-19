"use client";

import { ChevronDown } from "lucide-react";
import { ReactNode, useState } from "react";

import { cn } from "@/lib/utils/cn";

export function Accordion({ items }: { items: Array<{ id: string; title: string; content: ReactNode }> }) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const open = item.id === openId;
        return (
          <div key={item.id} className="overflow-hidden rounded-2xl border border-border">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : item.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="font-medium">{item.title}</span>
              <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
            </button>
            {open ? <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">{item.content}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
