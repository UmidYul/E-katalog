"use client";

import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { SearchForm } from "@/components/forms/search-form";
import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminOrders } from "@/features/orders/use-admin-orders";
import { formatPrice } from "@/lib/utils/format";
import type { AdminOrder } from "@/types/admin";

export default function AdminOrdersPage() {
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const orders = useAdminOrders({ status: status === "all" ? undefined : status, q, page: 1, limit: 30 });

  const columns: AdminColumn<AdminOrder>[] = [
    { key: "id", title: "Order", render: (x) => `#${x.id}` },
    { key: "user", title: "User ID", render: (x) => x.user_id },
    { key: "total", title: "Total", render: (x) => formatPrice(x.total_amount, x.currency) },
    { key: "status", title: "Status", render: (x) => x.status },
    {
      key: "actions",
      title: "Actions",
      render: (x) => (
        <Link href={`/dashboard/orders/${x.id}`} className="rounded-xl border border-input px-3 py-1 text-xs hover:bg-secondary">
          Details
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SearchForm value={q} onChange={setQ} />
        <div className="w-[180px]">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {orders.data?.items.length ? <AdminTable data={orders.data.items} columns={columns} /> : <EmptyState title="No orders" message="No matching orders." />}
    </div>
  );
}
