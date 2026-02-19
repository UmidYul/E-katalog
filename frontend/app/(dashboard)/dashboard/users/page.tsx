"use client";

import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { SkeletonTable } from "@/components/common/skeleton-table";
import { SearchForm } from "@/components/forms/search-form";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUsers, useDeleteUser } from "@/features/users/use-users";
import { useDashboardFiltersStore } from "@/store/filters.store";
import type { AdminUser } from "@/types/admin";

export default function AdminUsersPage() {
  const { query, setQuery, page, setPage, limit } = useDashboardFiltersStore();
  const users = useUsers({ q: query, page, limit, sort: "created_at" });
  const deleteUser = useDeleteUser();
  const [targetId, setTargetId] = useState<number | null>(null);

  const columns: AdminColumn<AdminUser>[] = [
    { key: "id", title: "ID", render: (u) => u.id, sortable: true },
    {
      key: "email",
      title: "User",
      render: (u) => (
        <div>
          <p className="font-medium">{u.full_name}</p>
          <p className="text-xs text-muted-foreground">{u.email}</p>
        </div>
      ),
    },
    { key: "role", title: "Role", render: (u) => <Badge>{u.role}</Badge> },
    { key: "is_active", title: "Status", render: (u) => (u.is_active ? "Active" : "Blocked") },
    {
      key: "actions",
      title: "Actions",
      render: (u) => (
        <div className="flex gap-2">
          <Link href={`/dashboard/users/${u.id}`} className="rounded-xl border border-input px-3 py-1.5 text-xs hover:bg-secondary">
            View
          </Link>
          <Button variant="secondary" size="sm" onClick={() => setTargetId(u.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  if (users.isLoading) return <SkeletonTable />;
  if (users.error) return <ErrorState title="Users unavailable" message="Failed to load users list." />;
  if (!users.data?.items.length) {
    return (
      <div className="space-y-3">
        <SearchForm value={query} onChange={setQuery} />
        <EmptyState title="No users found" message="Try another search query." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchForm value={query} onChange={setQuery} />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setPage(Math.max(page - 1, 1))}>
            Prev
          </Button>
          <Button variant="ghost" onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>
      <AdminTable data={users.data.items} columns={columns} />

      <ConfirmModal
        open={targetId !== null}
        onOpenChange={(v) => !v && setTargetId(null)}
        title="Delete user"
        description="This action is irreversible."
        loading={deleteUser.isPending}
        onConfirm={() => {
          if (!targetId) return;
          deleteUser.mutate(targetId, { onSuccess: () => setTargetId(null) });
        }}
      />
    </div>
  );
}
