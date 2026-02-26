import type { Metadata } from "next";
import Link from "next/link";

import { env } from "@/config/env";

export const metadata: Metadata = {
  title: "Для магазинов",
  alternates: { canonical: `${env.appUrl}/for-shops` }
};

const highlights = [
  "Подключение прайс-листа и регулярный импорт офферов",
  "Прозрачное сравнение по цене, наличию и доверительным сигналам",
  "Точки продвижения: карточка товара, подборки, брендовые блоки"
];

const packages = [
  { name: "Start", details: "Базовое размещение офферов и статистика переходов" },
  { name: "Growth", details: "Приоритетная выдача и расширенные лимиты категорий" },
  { name: "Promo", details: "Рекламные слоты и брендовые акценты в каталоге" }
];

export default function ForShopsPage() {
  return (
    <main className="container py-10">
      <section className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-3">
          <h1 className="font-heading text-3xl font-bold tracking-tight">Для магазинов и брендов</h1>
          <p className="text-muted-foreground">
            Подключайте магазин к E-katalog, получайте целевой трафик и управляйте эффективностью размещения.
          </p>
        </header>

        <ul className="list-disc space-y-1 pl-6">
          {highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        <section className="grid gap-4 md:grid-cols-3">
          {packages.map((pkg) => (
            <article key={pkg.name} className="rounded-lg border border-border/80 p-4">
              <h2 className="font-semibold">{pkg.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{pkg.details}</p>
            </article>
          ))}
        </section>

        <section className="rounded-lg border border-border/80 p-4">
          <h2 className="font-semibold">Подключение и реклама</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Для подключения магазина или запуска рекламных размещений отправьте запрос на{" "}
            <a className="underline" href="mailto:b2b@e-katalog.local">
              b2b@e-katalog.local
            </a>
            .
          </p>
          <div className="mt-3">
            <Link href="/contacts" className="text-sm underline">
              Контактные каналы и SLA-ответа
            </Link>
          </div>
        </section>
      </section>
    </main>
  );
}
