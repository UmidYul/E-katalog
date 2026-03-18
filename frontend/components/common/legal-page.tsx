import Link from "next/link";
import type { ReactNode } from "react";

type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  title: string;
  description?: string;
  updatedAt: string;
  sections: LegalSection[];
};

export function LegalPage({ title, description, updatedAt, sections }: LegalPageProps) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:py-10">
      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden md:block">
          <div className="sticky top-24 rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Мундарижа</p>
            <nav className="mt-3">
              <ul className="space-y-1.5 text-sm">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="text-muted-foreground transition-colors hover:text-foreground">
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        <article className="space-y-5 rounded-2xl border border-border bg-card p-5 md:p-6">
          <details className="rounded-xl border border-border px-4 py-3 md:hidden">
            <summary className="cursor-pointer text-sm font-medium">Мундарижа</summary>
            <nav className="mt-3">
              <ul className="space-y-2 text-sm">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`} className="text-muted-foreground transition-colors hover:text-foreground">
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </details>

          <header className="space-y-1.5">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">{title}</h1>
            <p className="text-sm text-muted-foreground">Охирги янгиланиш: {updatedAt}</p>
            {description ? <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </header>

          <div className="space-y-6 text-sm leading-7 text-foreground/90">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-24 space-y-2">
                <h2 className="font-heading text-xl font-semibold text-foreground">{section.title}</h2>
                <div className="space-y-2 text-muted-foreground">{section.content}</div>
              </section>
            ))}
          </div>

          <footer className="border-t border-border pt-4 text-sm">
            <Link href="/contacts" className="font-medium text-accent hover:underline">
              Саволингиз борми? → Алоқа
            </Link>
          </footer>
        </article>
      </div>
    </main>
  );
}
