"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useAdminSellerApplications,
  useAdminSellerApplicationHistory,
  useAdminSellerApplicationsSummary,
  useAdminSellerFinance,
  useAdminSellerProductModerationHistory,
  useAdminSellerProductModeration,
  useAdminSellerShops,
  useAdminSellerTariffAssignments,
  useAdminSellerTariffs,
  useAssignAdminSellerTariff,
  useBulkPatchAdminSellerApplicationsStatus,
  usePatchAdminSellerApplicationStatus,
  usePatchAdminSellerProductModerationStatus,
} from "@/features/sellers/use-admin-sellers";

const statusBadgeClass = (status: string) => {
  const normalized = String(status).toLowerCase();
  if (normalized === "approved" || normalized === "active") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (normalized === "rejected") return "border-rose-300 bg-rose-50 text-rose-800";
  if (normalized === "review" || normalized === "pending_moderation") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
};

const moderationStatusLabel: Record<string, string> = {
  draft: "Черновик",
  pending_moderation: "На модерации",
  active: "Активен",
  rejected: "Отклонен",
  archived: "В архиве",
};

const priorityBadgeClass = (priority: string) => {
  const normalized = String(priority).toLowerCase();
  if (normalized === "critical") return "border-rose-300 bg-rose-50 text-rose-800";
  if (normalized === "high") return "border-amber-300 bg-amber-50 text-amber-800";
  if (normalized === "resolved") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-sky-300 bg-sky-50 text-sky-800";
};

const historyActionLabel = (action: string) => {
  const normalized = String(action).trim().toLowerCase();
  if (normalized === "seller_application.submitted") return "Заявка создана";
  if (normalized === "seller_application.status_patch") return "Ручное изменение статуса";
  if (normalized === "seller_application.bulk_status_patch") return "Массовое изменение статуса";
  return normalized || "Событие";
};

const historyStatusLabel: Record<string, string> = {
  pending: "pending",
  review: "review",
  approved: "approved",
  rejected: "rejected",
};

const formatHistoryStatus = (status?: string | null) => {
  if (!status) return "-";
  return historyStatusLabel[status] ?? status;
};

const formatHistoryDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU");
};

const queueFilterMatch = (item: { status: string; age_hours?: number; is_duplicate_email?: boolean; is_duplicate_company?: boolean }) => {
  return {
    all: true,
    new: item.status === "pending" && Number(item.age_hours ?? 0) < 24,
    overdue: ["pending", "review"].includes(item.status) && Number(item.age_hours ?? 0) >= 24,
    needs_data: item.status === "review",
    duplicates: Boolean(item.is_duplicate_email || item.is_duplicate_company),
    rejected: item.status === "rejected",
  };
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  }
  return sorted[mid] ?? 0;
};

export default function AdminSellersPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [queueFilter, setQueueFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "age_desc" | "age_asc" | "company_asc" | "company_desc" | "priority_desc">("oldest");
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<"review" | "approved" | "rejected">("review");
  const [bulkNote, setBulkNote] = useState("");

  const [moderationStatusFilter, setModerationStatusFilter] = useState("pending_moderation");
  const [moderationQuery, setModerationQuery] = useState("");
  const [selectedModerationId, setSelectedModerationId] = useState<string | null>(null);
  const [moderationNote, setModerationNote] = useState("");

  const [assignShopId, setAssignShopId] = useState("");
  const [assignPlanCode, setAssignPlanCode] = useState("");

  const applicationsQuery = useAdminSellerApplications({
    status: statusFilter,
    q: query,
    country_code: countryFilter === "all" ? undefined : countryFilter,
    created_from: createdFrom || undefined,
    created_to: createdTo || undefined,
    duplicates_only: queueFilter === "duplicates" ? true : undefined,
    sort_by: sortBy,
    limit: 100,
    offset: 0,
  });
  const applicationsSummaryQuery = useAdminSellerApplicationsSummary({
    status: statusFilter,
    q: query,
    country_code: countryFilter === "all" ? undefined : countryFilter,
    created_from: createdFrom || undefined,
    created_to: createdTo || undefined,
  });
  const shopsQuery = useAdminSellerShops({ limit: 100, offset: 0 });
  const moderationQueryData = useAdminSellerProductModeration({ status: moderationStatusFilter, q: moderationQuery, limit: 100, offset: 0 });
  const financeQuery = useAdminSellerFinance({ limit: 100, offset: 0 });
  const tariffsQuery = useAdminSellerTariffs();
  const assignmentsQuery = useAdminSellerTariffAssignments({ limit: 200 });

  const patchStatus = usePatchAdminSellerApplicationStatus();
  const bulkPatchStatus = useBulkPatchAdminSellerApplicationsStatus();
  const patchModerationStatus = usePatchAdminSellerProductModerationStatus();
  const assignTariff = useAssignAdminSellerTariff();

  const allApplications = applicationsQuery.data?.items ?? [];
  const countryOptions = Array.from(
    new Set(
      allApplications
        .map((item) => String(item.country_code ?? "").trim().toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
  const visibleCountryOptions =
    countryFilter !== "all" && !countryOptions.includes(countryFilter) ? [countryFilter, ...countryOptions] : countryOptions;
  const applications = allApplications.filter((item) => {
    const flags = queueFilterMatch(item);
    return flags[queueFilter as keyof typeof flags] ?? true;
  });

  const shops = shopsQuery.data?.items ?? [];
  const moderationItems = moderationQueryData.data?.items ?? [];
  const financeItems = financeQuery.data?.items ?? [];
  const tariffs = tariffsQuery.data?.items ?? [];
  const assignments = assignmentsQuery.data?.items ?? [];

  const selected = allApplications.find((item) => item.id === selectedId) ?? null;
  const applicationHistoryQuery = useAdminSellerApplicationHistory(selectedId ?? undefined, { limit: 30, offset: 0 });
  const selectedModeration = moderationItems.find((item) => item.uuid === selectedModerationId) ?? null;
  const moderationHistoryQuery = useAdminSellerProductModerationHistory(selectedModerationId ?? undefined, { limit: 30, offset: 0 });
  const allSelected = applications.length > 0 && applications.every((item) => selectedIds.has(item.id));

  const pendingAges = applications
    .filter((item) => item.status === "pending" || item.status === "review")
    .map((item) => Number(item.age_hours ?? 0));
  const oldestPending = pendingAges.length ? Math.max(...pendingAges) : 0;
  const medianReview = median(pendingAges);

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(applications.map((item) => item.id)));
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submitStatus = async (status: "approved" | "review" | "rejected") => {
    if (!selected) return;
    if (status === "rejected" && !reviewNote.trim()) return;
    await patchStatus.mutateAsync({
      applicationId: selected.id,
      status,
      review_note: reviewNote.trim() || undefined,
    });
    setReviewNote("");
  };

  const submitBulkStatus = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (bulkStatus === "rejected" && !bulkNote.trim()) return;
    const confirmText =
      bulkStatus === "rejected"
        ? `Подтвердить массовый отказ для ${ids.length} заявок?`
        : `Подтвердить массовое обновление (${bulkStatus}) для ${ids.length} заявок?`;
    if (!window.confirm(confirmText)) return;

    await bulkPatchStatus.mutateAsync({
      application_ids: ids,
      status: bulkStatus,
      review_note: bulkNote.trim() || undefined,
    });
    setSelectedIds(new Set());
    setBulkNote("");
  };

  const exportApplicationsCsv = () => {
    const headers = ["id", "company_name", "email", "phone", "status", "priority", "age_hours", "submitted_at", "updated_at"];
    const rows = applications.map((item) =>
      [
        item.id,
        item.company_name,
        item.email,
        item.phone,
        item.status,
        item.priority ?? "",
        String(item.age_hours ?? ""),
        item.submitted_at ?? "",
        item.updated_at,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seller_applications_queue.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitModeration = async (status: "active" | "rejected" | "archived") => {
    if (!selectedModeration) return;
    if (status === "rejected" && !moderationNote.trim()) return;
    await patchModerationStatus.mutateAsync({
      productId: selectedModeration.uuid,
      status,
      moderation_comment: moderationNote.trim() || undefined,
    });
    setModerationNote("");
  };

  const submitAssignTariff = async () => {
    if (!assignShopId || !assignPlanCode) return;
    await assignTariff.mutateAsync({ shopId: assignShopId, plan_code: assignPlanCode });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Sellers</h2>
          <p className="text-sm text-muted-foreground">Заявки, магазины, модерация товаров, финансы и тарифы.</p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Badge className="border-slate-300 bg-slate-50 text-slate-700">Заявки: {applicationsQuery.data?.total ?? 0}</Badge>
          <Badge className="border-slate-300 bg-slate-50 text-slate-700">Магазины: {shopsQuery.data?.total ?? 0}</Badge>
          <Badge className="border-slate-300 bg-slate-50 text-slate-700">Модерация: {moderationQueryData.data?.total ?? 0}</Badge>
        </div>
      </div>

      <Tabs defaultValue="applications" className="space-y-4">
        <TabsList>
          <TabsTrigger value="applications">Заявки</TabsTrigger>
          <TabsTrigger value="shops">Магазины</TabsTrigger>
          <TabsTrigger value="moderation">Модерация товаров</TabsTrigger>
          <TabsTrigger value="finance">Финансы</TabsTrigger>
          <TabsTrigger value="tariffs">Тарифы</TabsTrigger>
        </TabsList>

        <TabsContent value="applications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Воронка лидов</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Badge className="justify-start border-slate-300 bg-slate-50 text-slate-700">Всего: {applicationsSummaryQuery.data?.total ?? 0}</Badge>
              <Badge className="justify-start border-sky-300 bg-sky-50 text-sky-800">
                Новые: {applicationsSummaryQuery.data?.status_counts.pending ?? 0}
              </Badge>
              <Badge className="justify-start border-amber-300 bg-amber-50 text-amber-800">
                В review: {applicationsSummaryQuery.data?.status_counts.review ?? 0}
              </Badge>
              <Badge className="justify-start border-emerald-300 bg-emerald-50 text-emerald-800">
                Одобрено: {applicationsSummaryQuery.data?.status_counts.approved ?? 0}
              </Badge>
              <Badge className="justify-start border-rose-300 bg-rose-50 text-rose-800">
                Отклонено: {applicationsSummaryQuery.data?.status_counts.rejected ?? 0}
              </Badge>
              <Badge className="justify-start border-slate-300 bg-slate-50 text-slate-700">
                За 7 дней: {applicationsSummaryQuery.data?.created_last_7d ?? 0}
              </Badge>
              <Badge className="justify-start border-slate-300 bg-slate-50 text-slate-700">
                Avg review: {applicationsSummaryQuery.data?.avg_review_hours ?? 0} ч
              </Badge>
              <Badge className="justify-start border-slate-300 bg-slate-50 text-slate-700">
                Oldest open: {applicationsSummaryQuery.data?.oldest_open_hours ?? 0} ч
              </Badge>
              <Badge className="justify-start border-slate-300 bg-slate-50 text-slate-700">
                Дубли: {applicationsSummaryQuery.data?.duplicates_count ?? 0}
              </Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Фильтры очереди</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  <SelectItem value="pending">Новые</SelectItem>
                  <SelectItem value="review">На ревью</SelectItem>
                  <SelectItem value="approved">Одобренные</SelectItem>
                  <SelectItem value="rejected">Отклоненные</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as "recent" | "oldest" | "age_desc" | "age_asc" | "company_asc" | "company_desc" | "priority_desc")}>
                <SelectTrigger>
                  <SelectValue placeholder="Сортировка" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="oldest">Сначала старые</SelectItem>
                  <SelectItem value="recent">Сначала новые</SelectItem>
                  <SelectItem value="age_desc">SLA: старше сначала</SelectItem>
                  <SelectItem value="age_asc">SLA: моложе сначала</SelectItem>
                  <SelectItem value="company_asc">Компания: A-Z</SelectItem>
                  <SelectItem value="company_desc">Компания: Z-A</SelectItem>
                  <SelectItem value="priority_desc">Приоритет: высокий сначала</SelectItem>
                </SelectContent>
              </Select>
              <Select value={queueFilter} onValueChange={setQueueFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Быстрый фильтр" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="new">Новые</SelectItem>
                  <SelectItem value="overdue">Просроченные SLA</SelectItem>
                  <SelectItem value="needs_data">Требуют данных</SelectItem>
                  <SelectItem value="duplicates">Дубли</SelectItem>
                  <SelectItem value="rejected">Отклоненные</SelectItem>
                </SelectContent>
              </Select>
              <Select value={countryFilter} onValueChange={setCountryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Страна" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все страны</SelectItem>
                  {visibleCountryOptions.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} />
              <Input type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по компании/email/телефону" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">SLA-панель</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <Badge className="border-slate-300 bg-slate-50 text-slate-700">Median time-to-review: {medianReview} ч</Badge>
              <Badge className="border-slate-300 bg-slate-50 text-slate-700">Oldest pending: {oldestPending} ч</Badge>
              <Button variant="secondary" onClick={exportApplicationsCsv}>
                Экспорт CSV
              </Button>
            </CardContent>
          </Card>

          {selectedIds.size ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bulk actions</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Badge className="w-fit border-slate-300 bg-slate-50 text-slate-700">Выбрано: {selectedIds.size}</Badge>
                <Select value={bulkStatus} onValueChange={(value) => setBulkStatus(value as "review" | "approved" | "rejected")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Действие" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="review">Перевести в review</SelectItem>
                    <SelectItem value="approved">Одобрить</SelectItem>
                    <SelectItem value="rejected">Отклонить</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={bulkNote}
                  onChange={(event) => setBulkNote(event.target.value)}
                  placeholder={bulkStatus === "rejected" ? "Комментарий обязателен при отказе" : "Комментарий (опционально)"}
                />
                <Button
                  disabled={bulkPatchStatus.isPending || (bulkStatus === "rejected" && !bulkNote.trim())}
                  onClick={() => void submitBulkStatus()}
                >
                  Применить
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleAll(Boolean(checked))} />
                </TableHead>
                <TableHead>Компания</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Страна</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Приоритет</TableHead>
                <TableHead>Provisioning</TableHead>
                <TableHead>Обновлено</TableHead>
                <TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((item) => (
                <TableRow key={item.id} className={selectedId === item.id ? "bg-secondary/40" : ""}>
                  <TableCell>
                    <Checkbox checked={selectedIds.has(item.id)} onCheckedChange={(checked) => toggleOne(item.id, Boolean(checked))} />
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{item.company_name}</p>
                    <p className="text-xs text-muted-foreground">{item.id}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.is_duplicate_company ? <Badge className="border-amber-300 bg-amber-50 text-amber-800">Дубль компании</Badge> : null}
                      {item.is_duplicate_email ? <Badge className="border-amber-300 bg-amber-50 text-amber-800">Дубль email</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{item.email}</p>
                    <p className="text-xs text-muted-foreground">{item.phone}</p>
                  </TableCell>
                  <TableCell>{item.country_code ?? "-"}</TableCell>
                  <TableCell>
                    <Badge className={statusBadgeClass(item.status)}>{item.status}</Badge>
                  </TableCell>
                  <TableCell>{item.age_hours ?? 0} ч</TableCell>
                  <TableCell>
                    <Badge className={priorityBadgeClass(item.priority ?? "normal")}>{item.priority ?? "normal"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className="border-slate-300 bg-slate-50 text-slate-700">{item.provisioning_status ?? "pending"}</Badge>
                  </TableCell>
                  <TableCell>{item.updated_at}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => setSelectedId(item.id)}>
                      Выбрать
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!applications.length ? (
                <TableRow>
                  <td colSpan={10} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    Заявки не найдены.
                  </td>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Панель ревью</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selected ? (
                <>
                  <div className="text-sm">
                    <p className="font-medium">{selected.company_name}</p>
                    <p className="text-muted-foreground">
                      {selected.email} - {selected.phone}
                    </p>
                  </div>
                  <Textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Комментарий для review/reject" rows={4} />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={patchStatus.isPending} onClick={() => void submitStatus("approved")}>
                      Одобрить
                    </Button>
                    <Button variant="secondary" disabled={patchStatus.isPending} onClick={() => void submitStatus("review")}>
                      Перевести в review
                    </Button>
                    <Button variant="destructive" disabled={patchStatus.isPending || !reviewNote.trim()} onClick={() => void submitStatus("rejected")}>
                      Отклонить
                    </Button>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">История коммуникаций</p>
                    {applicationHistoryQuery.isLoading ? <p className="text-xs text-muted-foreground">Загрузка истории...</p> : null}
                    {applicationHistoryQuery.data?.items?.length ? (
                      applicationHistoryQuery.data.items.map((entry) => (
                        <div key={entry.id} className="rounded-md border border-border/60 bg-background/80 p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{historyActionLabel(entry.action)}</p>
                            <p className="text-xs text-muted-foreground">{formatHistoryDate(entry.created_at)}</p>
                          </div>
                          {entry.status_to || entry.status_from ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatHistoryStatus(entry.status_from)} {"->"} {formatHistoryStatus(entry.status_to)}
                            </p>
                          ) : null}
                          {entry.review_note ? <p className="mt-1 text-xs text-muted-foreground">Комментарий: {entry.review_note}</p> : null}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.notification_sent === true ? (
                              <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800">Email отправлен</Badge>
                            ) : null}
                            {entry.notification_sent === false ? (
                              <Badge className="border-amber-300 bg-amber-50 text-amber-800">Email не отправлен</Badge>
                            ) : null}
                            {entry.notification_error ? (
                              <Badge className="border-rose-300 bg-rose-50 text-rose-800">Ошибка уведомления</Badge>
                            ) : null}
                            {entry.actor_user_id ? (
                              <Badge className="border-slate-300 bg-slate-50 text-slate-700">actor: {entry.actor_user_id}</Badge>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">История по заявке пока пустая.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Выберите заявку для ручной проверки.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shops" className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Магазин</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Контакт</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Обновлен</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shops.map((shop) => (
                <TableRow key={shop.uuid}>
                  <TableCell>
                    <p className="font-medium">{shop.shop_name}</p>
                    <p className="text-xs text-muted-foreground">{shop.uuid}</p>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusBadgeClass(shop.status)}>{shop.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm">{shop.contact_email}</p>
                    <p className="text-xs text-muted-foreground">{shop.contact_phone}</p>
                  </TableCell>
                  <TableCell>{shop.slug}</TableCell>
                  <TableCell>{shop.updated_at}</TableCell>
                </TableRow>
              ))}
              {!shops.length ? (
                <TableRow>
                  <td colSpan={5} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    Магазины не найдены.
                  </td>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="moderation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Фильтры модерации</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Select value={moderationStatusFilter} onValueChange={setModerationStatusFilter}>
                <SelectTrigger className="w-[240px]">
                  <SelectValue placeholder="Статус товара" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending_moderation">На модерации</SelectItem>
                  <SelectItem value="rejected">Отклоненные</SelectItem>
                  <SelectItem value="active">Активные</SelectItem>
                  <SelectItem value="draft">Черновики</SelectItem>
                  <SelectItem value="archived">Архив</SelectItem>
                </SelectContent>
              </Select>
              <Input value={moderationQuery} onChange={(event) => setModerationQuery(event.target.value)} placeholder="Поиск: товар / SKU / магазин" className="max-w-md" />
            </CardContent>
          </Card>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Товар</TableHead>
                <TableHead>Магазин</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Цена</TableHead>
                <TableHead>Остаток</TableHead>
                <TableHead className="text-right">Действие</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {moderationItems.map((item) => (
                <TableRow key={item.uuid} className={selectedModerationId === item.uuid ? "bg-secondary/40" : ""}>
                  <TableCell>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.uuid}</p>
                  </TableCell>
                  <TableCell>{item.shop_name}</TableCell>
                  <TableCell>
                    <Badge className={statusBadgeClass(item.status)}>{item.status}</Badge>
                  </TableCell>
                  <TableCell>{Number(item.price ?? 0).toLocaleString()} UZS</TableCell>
                  <TableCell>{item.stock_quantity}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => setSelectedModerationId(item.uuid)}>
                      Выбрать
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!moderationItems.length ? (
                <TableRow>
                  <td colSpan={6} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    Элементы модерации не найдены.
                  </td>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Действия модерации</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedModeration ? (
                <>
                  <div className="text-sm">
                    <p className="font-medium">{selectedModeration.title}</p>
                    <p className="text-muted-foreground">{selectedModeration.shop_name}</p>
                  </div>
                  <Textarea value={moderationNote} onChange={(event) => setModerationNote(event.target.value)} placeholder="Комментарий модератора" rows={3} />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={patchModerationStatus.isPending} onClick={() => void submitModeration("active")}>
                      Одобрить
                    </Button>
                    <Button variant="destructive" disabled={patchModerationStatus.isPending || !moderationNote.trim()} onClick={() => void submitModeration("rejected")}>
                      Отклонить
                    </Button>
                    <Button variant="secondary" disabled={patchModerationStatus.isPending} onClick={() => void submitModeration("archived")}>
                      Архивировать
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Выберите товар из списка модерации.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">История статусов товара</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedModeration ? <p className="text-sm text-muted-foreground">Выберите товар, чтобы увидеть timeline модерации.</p> : null}
              {selectedModeration && moderationHistoryQuery.isLoading ? <p className="text-sm text-muted-foreground">Загрузка истории...</p> : null}
              {selectedModeration && !moderationHistoryQuery.isLoading && moderationHistoryQuery.data?.items?.length ? (
                <ol className="relative ml-3 border-l border-slate-200 pl-5">
                  {moderationHistoryQuery.data.items.map((event) => {
                    const fromLabel = event.from_status ? moderationStatusLabel[event.from_status] ?? event.from_status : "—";
                    const toLabel = moderationStatusLabel[event.to_status] ?? event.to_status;
                    return (
                      <li key={event.id} className="relative pb-5 last:pb-0">
                        <span className="absolute -left-[1.45rem] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-400" />
                        <p className="text-xs text-muted-foreground">{event.created_at}</p>
                        <p className="text-sm font-medium">
                          {fromLabel}
                          {" -> "}
                          {toLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {event.reason_label}. Кто изменил: {event.actor_label}.
                        </p>
                        {event.comment ? <p className="mt-1 text-sm text-slate-700">Комментарий: {event.comment}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              {selectedModeration && !moderationHistoryQuery.isLoading && !moderationHistoryQuery.data?.items?.length ? (
                <p className="text-sm text-muted-foreground">История пока пустая.</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance" className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Магазин</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Баланс</TableHead>
                <TableHead>Кредитный лимит</TableHead>
                <TableHead>Пополнения</TableHead>
                <TableHead>Списания</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {financeItems.map((item) => (
                <TableRow key={item.shop_uuid}>
                  <TableCell>{item.shop_name}</TableCell>
                  <TableCell>
                    <Badge className={statusBadgeClass(item.shop_status)}>{item.shop_status}</Badge>
                  </TableCell>
                  <TableCell>{Number(item.balance ?? 0).toLocaleString()} UZS</TableCell>
                  <TableCell>{Number(item.credit_limit ?? 0).toLocaleString()} UZS</TableCell>
                  <TableCell>{Number(item.total_topup ?? 0).toLocaleString()} UZS</TableCell>
                  <TableCell>{Number(item.total_spend ?? 0).toLocaleString()} UZS</TableCell>
                </TableRow>
              ))}
              {!financeItems.length ? (
                <TableRow>
                  <td colSpan={6} className="px-4 py-3 text-center text-sm text-muted-foreground">
                    Данные по финансам не найдены.
                  </td>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="tariffs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Назначить тариф</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Select value={assignShopId} onValueChange={setAssignShopId}>
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder="Выберите магазин" />
                </SelectTrigger>
                <SelectContent>
                  {shops.map((shop) => (
                    <SelectItem key={shop.uuid} value={shop.uuid}>
                      {shop.shop_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={assignPlanCode} onValueChange={setAssignPlanCode}>
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder="Выберите тариф" />
                </SelectTrigger>
                <SelectContent>
                  {tariffs.map((plan) => (
                    <SelectItem key={plan.code} value={plan.code}>
                      {plan.name} ({Number(plan.monthly_fee ?? 0).toLocaleString()} {plan.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button disabled={assignTariff.isPending || !assignShopId || !assignPlanCode} onClick={() => void submitAssignTariff()}>
                Назначить
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Каталог тарифов</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Код</TableHead>
                    <TableHead>Абонплата</TableHead>
                    <TableHead>Включено кликов</TableHead>
                    <TableHead>Цена клика</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tariffs.map((plan) => (
                    <TableRow key={plan.uuid}>
                      <TableCell>{plan.name}</TableCell>
                      <TableCell>{plan.code}</TableCell>
                      <TableCell>
                        {Number(plan.monthly_fee ?? 0).toLocaleString()} {plan.currency}
                      </TableCell>
                      <TableCell>{plan.included_clicks}</TableCell>
                      <TableCell>
                        {Number(plan.click_price ?? 0).toLocaleString()} {plan.currency}
                      </TableCell>
                      <TableCell>
                        <Badge className={plan.is_active ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-50 text-slate-700"}>
                          {plan.is_active ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Текущие назначения</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Магазин</TableHead>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Код</TableHead>
                    <TableHead>Статус подписки</TableHead>
                    <TableHead>Назначен</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((item) => (
                    <TableRow key={item.shop_uuid}>
                      <TableCell>{item.shop_name}</TableCell>
                      <TableCell>{item.plan_name ?? "-"}</TableCell>
                      <TableCell>{item.plan_code ?? "-"}</TableCell>
                      <TableCell>
                        <Badge className="border-slate-300 bg-slate-50 text-slate-700">{item.subscription_status ?? "-"}</Badge>
                      </TableCell>
                      <TableCell>{item.assigned_at ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}
