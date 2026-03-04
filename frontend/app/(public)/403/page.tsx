import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-14">
      <article className="mx-auto max-w-xl rounded-xl border border-border bg-card p-7 text-center shadow-sm md:p-9">
        <span className="inline-flex rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
          Access Restricted
        </span>
        <h1 className="mt-4 font-heading text-5xl font-bold tracking-tight">403</h1>
        <p className="mt-3 text-sm text-muted-foreground">You do not have permission to access this section.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-secondary"
        >
          Go to home
        </Link>
      </article>
    </main>
  );
}
