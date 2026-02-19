"use client";

import { useParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUsers } from "@/features/users/use-users";

export default function AdminUserDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const users = useUsers({ page: 1, limit: 200 });
  const user = users.data?.items.find((x) => x.id === id);

  if (!user) {
    return <p className="text-sm text-muted-foreground">User not found in current dataset.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.full_name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Email: {user.email}</p>
        <p>Role: {user.role}</p>
        <p>Status: {user.is_active ? "Active" : "Blocked"}</p>
        <p>Created: {new Date(user.created_at).toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}
