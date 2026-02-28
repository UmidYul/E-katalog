import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="container py-10">
      <article className="mx-auto max-w-xl space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">403</h1>
        <p className="text-sm text-muted-foreground">You do not have permission to access this section.</p>
        <Link href="/" className="inline-flex rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary">
          Go to home
        </Link>
      </article>
    </main>
  );
}
