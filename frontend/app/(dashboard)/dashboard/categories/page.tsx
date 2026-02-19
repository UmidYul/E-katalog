"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAdminCategories, useCreateCategory } from "@/features/categories/use-admin-categories";
import { categorySchema, type CategoryFormValues } from "@/lib/validators/admin";
import type { AdminCategory } from "@/types/admin";

export default function AdminCategoriesPage() {
  const categories = useAdminCategories();
  const createCategory = useCreateCategory();
  const [open, setOpen] = useState(false);
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", slug: "", parent_id: null },
  });

  const columns: AdminColumn<AdminCategory>[] = [
    { key: "id", title: "ID", render: (x) => x.id },
    { key: "name", title: "Name", render: (x) => x.name },
    { key: "slug", title: "Slug", render: (x) => x.slug },
    { key: "parent", title: "Parent", render: (x) => x.parent_id ?? "-" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>Add category</Button>
      </div>
      <AdminTable data={categories.data ?? []} columns={columns} />

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Create category"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={form.handleSubmit((values) => {
                createCategory.mutate(values, { onSuccess: () => setOpen(false) });
              })}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Name</p>
            <Input {...form.register("name")} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Slug</p>
            <Input {...form.register("slug")} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Parent ID</p>
            <Input
              type="number"
              onChange={(e) => form.setValue("parent_id", e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
