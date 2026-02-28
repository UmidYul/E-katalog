"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useUpdateUser, useUserById } from "@/features/users/use-users";
import type { AdminRole } from "@/types/admin";

const roleOptions: AdminRole[] = ["user", "moderator", "seller_support", "admin"];

export default function AdminUserDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const userQuery = useUserById(id);
  const updateUser = useUpdateUser();
  const user = userQuery.data;
  const [role, setRole] = useState<AdminRole>("user");
  const [isActive, setIsActive] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const nextRole = roleOptions.includes(user.role) ? user.role : "user";
    setRole(nextRole);
    setIsActive(user.is_active);
  }, [user]);

  const createdAt = useMemo(() => {
    if (!user?.created_at) return "Unknown";
    const parsed = new Date(user.created_at);
    if (Number.isNaN(parsed.getTime())) return "Unknown";
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
  }, [user?.created_at]);

  const changed = user ? user.role !== role || user.is_active !== isActive : false;

  if (userQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading user...</p>;
  }

  if (userQuery.isError || !user) {
    return <p className="text-sm text-muted-foreground">User not found in current dataset.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.full_name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Email: {user.email}</p>
        <p>Created: {createdAt}</p>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Role</p>
          <div className="max-w-[280px]">
            <Select value={role} onValueChange={(value) => setRole(value as AdminRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <p className="text-sm">User is active</p>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={!changed || updateUser.isPending}
            onClick={() => {
              setNotice(null);
              updateUser.mutate(
                {
                  id: user.id,
                  payload: { role, is_active: isActive },
                },
                {
                  onSuccess: () => setNotice("User updated."),
                  onError: (error) => setNotice(error instanceof Error ? error.message : "Failed to update user."),
                },
              );
            }}
          >
            {updateUser.isPending ? "Saving..." : "Save changes"}
          </Button>
          {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

