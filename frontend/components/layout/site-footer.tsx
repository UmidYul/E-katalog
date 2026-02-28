import Link from "next/link";

const footerColumns = [
  {
    title: "Каталог",
    links: [
      { href: "/catalog", label: "Все товары" },
      { href: "/compare", label: "Сравнение" },
      { href: "/favorites", label: "Избранное" }
    ]
  },
  {
    title: "Покупателям",
    links: [
      { href: "/recently-viewed", label: "Недавно просмотренные" },
      { href: "/favorites", label: "Список избранного" },
      { href: "/login", label: "Вход в аккаунт" }
    ]
  },
  {
    title: "Продавцам",
    links: [
      { href: "/for-shops", label: "Для магазинов" },
      { href: "/become-seller", label: "Стать продавцом" },
      { href: "/status", label: "Статус сервиса" }
    ]
  },
  {
    title: "О нас",
    links: [
      { href: "/contacts", label: "Контакты" },
      { href: "/about", label: "О проекте" },
      { href: "/", label: "Главная" }
    ]
  }
];

export function SiteFooter() {
  const currentYear = new Date().getUTCFullYear();

  return (
    <footer className="mt-20 bg-background/70 pb-8 pt-10">
      <div className="container space-y-8">
        <div className="h-px w-full bg-gradient-to-r from-primary/40 via-primary to-primary/40" />

        <div className="grid gap-6 md:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <div className="space-y-3">
            <p className="font-heading text-xl font-extrabold tracking-tight text-gradient">e-katalog</p>
            <p className="text-sm text-muted-foreground">
              Технологичный агрегатор цен на электронику с акцентом на прозрачность и точность.
            </p>
            <p className="text-xs text-muted-foreground">
              Сравнивайте предложения проверенных магазинов, отслеживайте динамику цен и находите лучшие офферы.
            </p>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title} className="space-y-2">
              <p className="text-sm font-semibold text-foreground">{column.title}</p>

              <div className="md:hidden">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm font-medium text-foreground">
                    <span>{column.title}</span>
                    <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90">
                      ▸
                    </span>
                  </summary>
                  <ul className="mt-1 space-y-1.5 text-sm text-muted-foreground">
                    {column.links.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href} className="transition-colors hover:text-foreground">
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>

              <div className="hidden md:block">
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {column.links.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="transition-colors hover:text-foreground">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/80 pt-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>{currentYear} e-katalog. Все права защищены.</p>
          <div className="flex flex-wrap items-center gap-3">
            <span>Данные по ценам агрегируются автоматически и обновляются регулярно.</span>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
              <span className="text-border-strong">•</span>
              <Link href="/terms" className="hover:text-foreground">
                Terms
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

