"use client";

import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { SkeletonTable } from "@/components/common/skeleton-table";
import { SearchForm } from "@/components/forms/search-form";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useAdminProducts, useBulkDeleteProducts, useDeleteProduct, useRunAdminTask } from "@/features/products/use-admin-products";
import { adminApi } from "@/lib/api/openapi-client";
import { formatPrice } from "@/lib/utils/format";
import { useDashboardFiltersStore } from "@/store/filters.store";
import type { AdminProduct } from "@/types/admin";

export default function AdminProductsPage() {
  const { query, setQuery, page, setPage, limit } = useDashboardFiltersStore();
  const products = useAdminProducts({ q: query, page, limit, sort: "newest" });
  const deleteProduct = useDeleteProduct();
  const bulkDeleteProducts = useBulkDeleteProducts();
  const runTask = useRunAdminTask();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const rowIds = useMemo(() => (products.data?.items ?? []).map((item) => item.id), [products.data?.items]);
  const allChecked = rowIds.length > 0 && rowIds.every((id) => selectedIds.includes(id));
  const selectedCount = selectedIds.length;

  const toggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id)));
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      if (!checked) return prev.filter((id) => !rowIds.includes(id));
      return Array.from(new Set([...prev, ...rowIds]));
    });
  };

  const openImportPicker = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportPending(true);
    setImportFeedback(null);
    try {
      const content = await file.text();
      const source = file.name.toLowerCase().endsWith(".csv") ? "csv" : "json";
      const { data } = await adminApi.bulkImportProducts({ source, content });
      const firstError = data.errors?.[0] ? ` First warning: ${data.errors[0]}` : "";
      setImportFeedback(`Imported ${data.imported_rows}/${data.received_rows}. Pipeline task: ${data.task_id}.${firstError}`);
      await products.refetch();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      setImportFeedback(`Import failed: ${message}`);
    } finally {
      event.target.value = "";
      setImportPending(false);
    }
  };

  const handleExportCsv = async () => {
    setExportPending(true);
    try {
      const response = await adminApi.bulkExportProducts("csv");
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: "text/csv;charset=utf-8" });
      const contentDisposition = response.headers["content-disposition"];
      const match = /filename=\"?([^\";]+)\"?/i.exec(contentDisposition ?? "");
      const fileName = match?.[1] || `products_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      setImportFeedback(`Export failed: ${message}`);
    } finally {
      setExportPending(false);
    }
  };

  const handleRunCatalogRebuild = () => {
    setImportFeedback(null);
    runTask.mutate("catalog", {
      onSuccess: (result) => {
        setImportFeedback(`Catalog rebuild queued. Task: ${result.data.task_id}.`);
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        setImportFeedback(`Catalog rebuild failed: ${message}`);
      },
    });
  };

  const columns: AdminColumn<AdminProduct>[] = [
    {
      key: "select",
      title: <Checkbox checked={allChecked} onCheckedChange={toggleAll} disabled={!rowIds.length} />,
      className: "w-10",
      render: (x) => (
        <Checkbox checked={selectedIds.includes(x.id)} onCheckedChange={(checked) => toggleRow(x.id, checked)} />
      ),
    },
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
          <Link href={`/dashboard/admin/products/${x.id}`} className="rounded-xl border border-input px-3 py-1.5 text-xs hover:bg-secondary">
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
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,.json,application/json,text/csv"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button variant="ghost" className="gap-2" onClick={handleExportCsv} disabled={exportPending || importPending}>
              <Download className="h-4 w-4" /> {exportPending ? "Exporting..." : "Export CSV"}
            </Button>
            <Button variant="secondary" className="gap-2" onClick={openImportPicker} disabled={importPending || exportPending}>
              <Upload className="h-4 w-4" /> {importPending ? "Importing..." : "Import file"}
            </Button>
            <Button variant="secondary" onClick={handleRunCatalogRebuild} disabled={runTask.isPending || importPending || exportPending}>
              {runTask.isPending ? "Queuing rebuild..." : "Rebuild catalog"}
            </Button>
            <Button
              variant="secondary"
              disabled={selectedCount === 0 || importPending || exportPending || runTask.isPending}
              onClick={() => setBulkDeleteOpen(true)}
            >
              Delete selected ({selectedCount})
            </Button>
          </div>
          {importFeedback ? <p className="w-full text-xs text-muted-foreground">{importFeedback}</p> : null}
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
          deleteProduct.mutate(targetId, {
            onSuccess: () => {
              setTargetId(null);
              setSelectedIds((prev) => prev.filter((id) => id !== targetId));
            },
          });
        }}
      />

      <ConfirmModal
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected products"
        description={`This will delete ${selectedCount} products.`}
        loading={bulkDeleteProducts.isPending}
        onConfirm={() => {
          if (!selectedIds.length) return;
          bulkDeleteProducts.mutate(selectedIds, {
            onSuccess: () => {
              setBulkDeleteOpen(false);
              setSelectedIds([]);
            },
          });
        }}
      />
    </div>
  );
}

