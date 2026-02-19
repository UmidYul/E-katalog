import { ReactNode } from "react";

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span title={content} className="inline-flex">
      {children}
    </span>
  );
}
