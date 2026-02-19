"use client";

import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { SkeletonTable } from "@/components/common/skeleton-table";
import { SearchForm } from "@/components/forms/search-form";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminProducts, useDeleteProduct } from "@/features/products/use-admin-products";
import { adminApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import { useDashboardFiltersStore } from "@/store/filters.store";
import type { AdminProduct } from "@/types/admin";

export default function AdminProductsPage() {
  const { query, setQuery, page, setPage, limit } = useDashboardFiltersStore();
  const products = useAdminProducts({ q: query, page, limit, sort: "newest" });
  const deleteProduct = useDeleteProduct();
  const [targetId, setTargetId] = useState<number | null>(null);

  const columns: AdminColumn<AdminProduct>[] = [
    { key: "id", title: "ID", sortable: true, render: (x) => x.id },
    {
      key: "title",
      title: "Product",
      render: (x) => (
        <div>
          <p className="line-clamp-1 font-medium">{x.normalized_title}</p>
          <p className="text-xs text-muted-foreground">{x.brand?.name ?? "No brand"}</p>
        </div>
      ),
    },
    { key: "price", title: "Min price", render: (x) => formatPrice(x.min_price ?? 0) },
    { key: "stores", title: "Stores", render: (x) => x.store_count },
    {
      key: "actions",
      title: "Actions",
      render: (x) => (
        <div className="flex gap-2">
          <Link href={`/dashboard/products/${x.id}`} className="rounded-xl border border-input px-3 py-1.5 text-xs hover:bg-secondary">
            View
          </Link>
          <Button size="sm" variant="secondary" onClick={() => setTargetId(x.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  if (products.isLoading) return <SkeletonTable />;
  if (products.error) return <ErrorState title="Products unavailable" message="Failed to load products." />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <SearchForm value={query} onChange={setQuery} />
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="gap-2" onClick={() => adminApi.bulkExportProducts("csv")}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="secondary" className="gap-2" onClick={() => adminApi.bulkImportProducts({ source: "json", content: "[]" })}>
              <Upload className="h-4 w-4" /> Import JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      {!products.data?.items.length ? <EmptyState title="No products" message="Try changing filters." /> : <AdminTable data={products.data.items} columns={columns} />}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setPage(Math.max(page - 1, 1))}>
          Prev
        </Button>
        <Button variant="ghost" onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>

      <ConfirmModal
        open={targetId !== null}
        onOpenChange={(v) => !v && setTargetId(null)}
        title="Delete product"
        description="Product and related offers may be detached."
        loading={deleteProduct.isPending}
        onConfirm={() => {
          if (!targetId) return;
          deleteProduct.mutate(targetId, { onSuccess: () => setTargetId(null) });
        }}
      />
    </div>
  );
}
