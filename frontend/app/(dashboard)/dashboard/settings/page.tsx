"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { AdminTable, type AdminColumn } from "@/components/tables/admin-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import {
  useAdminStores,
  useCreateAdminStore,
  useCreateStoreSource,
  useDeleteAdminStore,
  useDeleteStoreSource,
  useStoreSources,
  useUpdateAdminStore,
  useUpdateStoreSource,
} from "@/features/settings/use-admin-stores";
import { useAdminSettings, useUpdateAdminSettings } from "@/features/settings/use-admin-settings";
import {
  adminStoreSchema,
  scrapeSourceSchema,
  settingsSchema,
  type AdminStoreFormValues,
  type ScrapeSourceFormValues,
  type SettingsFormValues,
} from "@/lib/validators/admin";
import type { AdminScrapeSource, AdminStore } from "@/types/admin";

export default function AdminSettingsPage() {
  const settings = useAdminSettings();
  const update = useUpdateAdminSettings();
  const stores = useAdminStores();
  const createStore = useCreateAdminStore();
  const updateStore = useUpdateAdminStore();
  const deleteStore = useDeleteAdminStore();
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const sources = useStoreSources(selectedStoreId);
  const createSource = useCreateStoreSource(selectedStoreId);
  const updateSource = useUpdateStoreSource(selectedStoreId);
  const deleteSource = useDeleteStoreSource(selectedStoreId);
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<AdminStore | null>(null);
  const [editingSource, setEditingSource] = useState<AdminScrapeSource | null>(null);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      site_name: "",
      support_email: "",
      branding_logo_url: null,
      feature_ai_enabled: true,
    },
  });
  const storeForm = useForm<AdminStoreFormValues>({
    resolver: zodResolver(adminStoreSchema),
    defaultValues: {
      name: "",
      slug: "",
      provider: "generic",
      base_url: null,
      country_code: "UZ",
      trust_score: 0.8,
      crawl_priority: 100,
      is_active: true,
    },
  });
  const sourceForm = useForm<ScrapeSourceFormValues>({
    resolver: zodResolver(scrapeSourceSchema),
    defaultValues: {
      url: "",
      source_type: "category",
      priority: 100,
      is_active: true,
    },
  });

  useEffect(() => {
    if (settings.data) {
      form.reset({
        site_name: settings.data.site_name,
        support_email: settings.data.support_email,
        branding_logo_url: settings.data.branding_logo_url ?? null,
        feature_ai_enabled: settings.data.feature_ai_enabled,
      });
    }
  }, [form, settings.data]);
  useEffect(() => {
    const firstStore = stores.data?.[0];
    if (!selectedStoreId && firstStore) {
      setSelectedStoreId(firstStore.id);
    }
  }, [selectedStoreId, stores.data]);

  const selectedStore = useMemo(() => stores.data?.find((x) => x.id === selectedStoreId) ?? null, [stores.data, selectedStoreId]);

  const storeColumns: AdminColumn<AdminStore>[] = [
    { key: "name", title: "Store", render: (x) => <div className="font-medium">{x.name}</div> },
    { key: "provider", title: "Provider", render: (x) => <Badge>{x.provider}</Badge> },
    { key: "priority", title: "Priority", render: (x) => x.crawl_priority },
    { key: "sources", title: "Links", render: (x) => x.sources_count },
    {
      key: "active",
      title: "Active",
      render: (x) => (
        <Switch
          checked={x.is_active}
          onCheckedChange={(checked) => updateStore.mutate({ id: x.id, payload: { is_active: checked } })}
        />
      ),
    },
    {
      key: "actions",
      title: "Actions",
      render: (x) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={selectedStoreId === x.id ? "default" : "secondary"}
            onClick={() => setSelectedStoreId(x.id)}
          >
            Links
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditingStore(x);
              storeForm.reset({
                name: x.name,
                slug: x.slug,
                provider: x.provider,
                base_url: x.base_url ?? null,
                country_code: x.country_code,
                trust_score: Number(x.trust_score ?? 0.8),
                crawl_priority: Number(x.crawl_priority ?? 100),
                is_active: x.is_active,
              });
              setStoreModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => deleteStore.mutate(x.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  const sourceColumns: AdminColumn<AdminScrapeSource>[] = [
    { key: "url", title: "URL", render: (x) => <span className="text-xs">{x.url}</span> },
    { key: "type", title: "Type", render: (x) => x.source_type },
    { key: "priority", title: "Priority", render: (x) => x.priority },
    {
      key: "active",
      title: "Active",
      render: (x) => (
        <Switch
          checked={x.is_active}
          onCheckedChange={(checked) => updateSource.mutate({ sourceId: x.id, payload: { is_active: checked } })}
        />
      ),
    },
    {
      key: "actions",
      title: "Actions",
      render: (x) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditingSource(x);
              sourceForm.reset({
                url: x.url,
                source_type: x.source_type,
                priority: Number(x.priority ?? 100),
                is_active: x.is_active,
              });
              setSourceModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => deleteSource.mutate(x.id)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Platform settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Site name</p>
            <Input {...form.register("site_name")} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Support email</p>
            <Input {...form.register("support_email")} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Brand logo URL</p>
            <Input {...form.register("branding_logo_url")} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div>
              <p className="text-sm font-medium">AI enrichment</p>
              <p className="text-xs text-muted-foreground">Enable AI normalization pipelines</p>
            </div>
            <Switch checked={form.watch("feature_ai_enabled")} onCheckedChange={(v) => form.setValue("feature_ai_enabled", v)} />
          </div>
          <Button
            onClick={form.handleSubmit((values) => {
              update.mutate(values);
            })}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving..." : "Save settings"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Stores for scraper</CardTitle>
          <Button
            onClick={() => {
              setEditingStore(null);
              storeForm.reset({
                name: "",
                slug: "",
                provider: "generic",
                base_url: null,
                country_code: "UZ",
                trust_score: 0.8,
                crawl_priority: 100,
                is_active: true,
              });
              setStoreModalOpen(true);
            }}
          >
            Add store
          </Button>
        </CardHeader>
        <CardContent>
          <AdminTable data={stores.data ?? []} columns={storeColumns} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Scrape links {selectedStore ? `for ${selectedStore.name}` : ""}</CardTitle>
          <Button
            disabled={!selectedStoreId}
            onClick={() => {
              setEditingSource(null);
              sourceForm.reset({ url: "", source_type: "category", priority: 100, is_active: true });
              setSourceModalOpen(true);
            }}
          >
            Add link
          </Button>
        </CardHeader>
        <CardContent>
          <AdminTable data={sources.data ?? []} columns={sourceColumns} />
        </CardContent>
      </Card>

      <Modal
        open={storeModalOpen}
        onOpenChange={setStoreModalOpen}
        title={editingStore ? "Edit store" : "Create store"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStoreModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={storeForm.handleSubmit((values) => {
                if (editingStore) {
                  updateStore.mutate(
                    {
                      id: editingStore.id,
                      payload: values,
                    },
                    { onSuccess: () => setStoreModalOpen(false) },
                  );
                  return;
                }
                createStore.mutate(values, {
                  onSuccess: (result) => {
                    setSelectedStoreId(result.data.id);
                    setStoreModalOpen(false);
                  },
                });
              })}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input placeholder="Store name" {...storeForm.register("name")} />
          <Input placeholder="Slug (optional)" {...storeForm.register("slug")} />
          <Input placeholder="Provider (texnomart, uzum, generic)" {...storeForm.register("provider")} />
          <Input placeholder="Base URL (optional)" {...storeForm.register("base_url")} />
          <Input placeholder="Country code" {...storeForm.register("country_code")} />
          <Input
            type="number"
            step="0.01"
            placeholder="Trust score 0..1"
            onChange={(e) => storeForm.setValue("trust_score", Number(e.target.value))}
            defaultValue={storeForm.getValues("trust_score")}
          />
          <Input
            type="number"
            placeholder="Crawl priority"
            onChange={(e) => storeForm.setValue("crawl_priority", Number(e.target.value))}
            defaultValue={storeForm.getValues("crawl_priority")}
          />
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <p className="text-sm">Active</p>
            <Switch checked={storeForm.watch("is_active")} onCheckedChange={(v) => storeForm.setValue("is_active", v)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={sourceModalOpen}
        onOpenChange={setSourceModalOpen}
        title={editingSource ? "Edit scrape link" : "Create scrape link"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSourceModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={sourceForm.handleSubmit((values) => {
                if (!selectedStoreId) return;
                if (editingSource) {
                  updateSource.mutate(
                    {
                      sourceId: editingSource.id,
                      payload: values,
                    },
                    { onSuccess: () => setSourceModalOpen(false) },
                  );
                  return;
                }
                createSource.mutate(values, { onSuccess: () => setSourceModalOpen(false) });
              })}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input placeholder="https://..." {...sourceForm.register("url")} />
          <Input placeholder="Source type (category/search/sitemap)" {...sourceForm.register("source_type")} />
          <Input
            type="number"
            placeholder="Priority"
            onChange={(e) => sourceForm.setValue("priority", Number(e.target.value))}
            defaultValue={sourceForm.getValues("priority")}
          />
          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <p className="text-sm">Active</p>
            <Switch checked={sourceForm.watch("is_active")} onCheckedChange={(v) => sourceForm.setValue("is_active", v)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

