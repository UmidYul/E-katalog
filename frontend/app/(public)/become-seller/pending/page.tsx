import Link from "next/link";

export default function BecomeSellerPendingPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Application received</h1>
        <p className="text-sm text-muted-foreground">We will review your request within 1-3 business days.</p>
        <Link href="/" className="inline-flex rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary">
          Back to home
        </Link>
      </article>
    </main>
  );
}
