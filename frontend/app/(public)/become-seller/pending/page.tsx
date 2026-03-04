import Link from "next/link";

export default function BecomeSellerPendingPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10">
      <article className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">Seller onboarding</span>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Заявка получена</h1>
        <p className="text-sm text-muted-foreground">Проверка обычно занимает 1-3 рабочих дня. Результат придет на указанные контакты.</p>
        <Link href="/" className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary">
          На главную
        </Link>
      </article>
    </main>
  );
}
