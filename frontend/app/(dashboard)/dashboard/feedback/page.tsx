"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { SkeletonTable } from "@/components/common/skeleton-table";
import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminFeedbackQueue, useModerateFeedbackItem } from "@/features/feedback/use-admin-feedback";
import type { AdminFeedbackQueueItem } from "@/types/admin";

const PAGE_LIMIT = 20;

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
};

const statusBadgeClass = (status: string) => {
  if (status === "published") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  if (status === "pending") return "bg-amber-100 text-amber-700";
  return "bg-secondary/80";
};

const kindBadgeClass = (kind: string) => {
  if (kind === "review") return "bg-sky-100 text-sky-700";
  return "bg-violet-100 text-violet-700";
};

const normalizeError = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
};

export default function AdminFeedbackPage() {
  const [status, setStatus] = useState<"all" | "published" | "pending" | "rejected">("pending");
  const [kind, setKind] = useState<"all" | "review" | "question">("all");
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status, kind]);

  const query = useMemo(
    () => ({
      status,
      kind,
      limit: PAGE_LIMIT,
      offset: (page - 1) * PAGE_LIMIT,
    }),
    [status, kind, page],
  );
  const queue = useAdminFeedbackQueue(query);
  const moderate = useModerateFeedbackItem();
  const total = queue.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const onModerate = async (item: AdminFeedbackQueueItem, nextStatus: "published" | "pending" | "rejected") => {
    setFeedback(null);
    try {
      await moderate.mutateAsync({ kind: item.kind, id: item.id, status: nextStatus });
      setFeedback(`${item.kind} ${item.id} updated to ${nextStatus}.`);
    } catch (error) {
      setFeedback(normalizeError(error, "Moderation update failed."));
    }
  };

  const columns: AdminColumn<AdminFeedbackQueueItem>[] = [
    {
      key: "kind",
      title: "Type",
      render: (item) => <Badge className={kindBadgeClass(item.kind)}>{item.kind}</Badge>,
    },
    {
      key: "product_id",
      title: "Product",
      render: (item) => (
        <Link href={`/product/${item.product_id}`} className="text-sm font-medium text-primary hover:underline">
          #{item.product_id}
        </Link>
      ),
    },
    { key: "author", title: "Author", render: (item) => <span className="text-sm">{item.author}</span> },
    {
      key: "body",
      title: "Content",
      render: (item) => (
        <div>
          <p className="line-clamp-2 text-sm">{item.body}</p>
          {typeof item.rating === "number" ? <p className="mt-1 text-xs text-muted-foreground">Rating: {item.rating}/5</p> : null}
        </div>
      ),
    },
    { key: "status", title: "Status", render: (item) => <Badge className={statusBadgeClass(item.status)}>{item.status}</Badge> },
    { key: "updated_at", title: "Updated", render: (item) => <span className="text-xs text-muted-foreground">{formatDateTime(item.updated_at)}</span> },
    {
      key: "actions",
      title: "Moderation",
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={moderate.isPending || item.status === "published"}
            onClick={() => onModerate(item, "published")}
          >
            Publish
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={moderate.isPending || item.status === "pending"}
            onClick={() => onModerate(item, "pending")}
          >
            Pending
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={moderate.isPending || item.status === "rejected"}
            onClick={() => onModerate(item, "rejected")}
          >
            Reject
          </Button>
        </div>
      ),
    },
  ];

  if (queue.isLoading) return <SkeletonTable />;
  if (queue.isError) return <ErrorState title="Feedback queue unavailable" message="Failed to load moderation queue." />;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Total items</p>
            <p className="text-xl font-semibold">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Published</p>
            <p className="text-xl font-semibold">{queue.data?.status_counts?.published ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-xl font-semibold">{queue.data?.status_counts?.pending ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Rejected</p>
            <p className="text-xl font-semibold">{queue.data?.status_counts?.rejected ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Reviews / Questions</p>
            <p className="text-xl font-semibold">
              {queue.data?.kind_counts?.review ?? 0} / {queue.data?.kind_counts?.question ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="w-[180px]">
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[180px]">
          <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="review">Reviews</SelectItem>
              <SelectItem value="question">Questions</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" onClick={() => queue.refetch()} disabled={queue.isFetching}>
          {queue.isFetching ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {feedback ? <p className="text-xs text-muted-foreground">{feedback}</p> : null}

      {queue.data?.items.length ? (
        <>
          <AdminTable data={queue.data.items} columns={columns} />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={page <= 1}>
              Prev
            </Button>
            <p className="text-xs text-muted-foreground">
              Page {page} / {totalPages}
            </p>
            <Button variant="ghost" onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </>
      ) : (
        <EmptyState title="No feedback found" message="Try changing moderation filters." />
      )}
    </div>
  );
}
