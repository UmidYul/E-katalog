import Link from "next/link";

export default function BecomeSellerRejectedPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6">
        <span className="inline-flex rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-destructive">
          Seller onboarding
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Заявка отклонена</h1>
        <p className="text-sm text-muted-foreground">Проверьте данные, исправьте замечания и отправьте заявку повторно.</p>
        <Link href="/become-seller" className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary">
          Отправить снова
        </Link>
      </article>
    </main>
  );
}
