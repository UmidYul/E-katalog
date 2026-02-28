"use client";

import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminOrders, useUpdateOrderStatus } from "@/features/orders/use-admin-orders";
import type { AdminOrder } from "@/types/admin";

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
};

export default function AdminOrderDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const orders = useAdminOrders({ page: 1, limit: 200 });
  const updateStatus = useUpdateOrderStatus();
  const order = orders.data?.items.find((x) => x.id === id);

  if (!order) return <p className="text-sm text-muted-foreground">Order not found.</p>;

  const statuses: AdminOrder["status"][] = ["new", "processing", "completed", "cancelled"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order #{order.id}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm">
          <p>User: {order.user_id}</p>
          <p>Total: {order.total_amount} {order.currency}</p>
          <p>Current status: {order.status}</p>
          <p>Created: {formatDateTime(order.created_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {statuses.map((status) => (
            <Button key={status} variant={order.status === status ? "default" : "secondary"} onClick={() => updateStatus.mutate({ id: order.id, status })}>
              {status}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

