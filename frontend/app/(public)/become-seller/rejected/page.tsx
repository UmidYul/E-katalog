import Link from "next/link";

export default function BecomeSellerRejectedPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Заявка отклонена</h1>
        <p className="text-sm text-muted-foreground">Обновите данные и отправьте заявку повторно.</p>
        <Link href="/become-seller" className="inline-flex rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary">
          Отправить снова
        </Link>
      </article>
    </main>
  );
}
