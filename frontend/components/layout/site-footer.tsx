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
    title: "Аккаунт",
    links: [
      { href: "/profile", label: "Профиль" },
      { href: "/recently-viewed", label: "Недавно просмотренные" },
      { href: "/login", label: "Вход" }
    ]
  },
  {
    title: "Сервис",
    links: [
      { href: "/partners", label: "Partners" },
      { href: "/status", label: "Статус сервиса" },
      { href: "/contacts", label: "Контакты" },
      { href: "/", label: "Главная" }
    ]
  },
  {
    title: "Правовая информация",
    links: [
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
      { href: "/cookies", label: "Cookie Policy" }
    ]
  }
];

export function SiteFooter() {
  const currentYear = new Date().getUTCFullYear();

  return (
    <footer className="mt-20 border-t border-border/80 bg-background/70 py-10 backdrop-blur">
      <div className="container space-y-8">
        <div className="grid gap-6 md:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
          <div className="space-y-2">
            <p className="font-heading text-xl font-extrabold tracking-tight">E-katalog</p>
            <p className="text-sm text-muted-foreground">Строгое и прозрачное сравнение цен по проверенным магазинам.</p>
            <p className="text-xs text-muted-foreground">Актуальные офферы, история стоимости и удобный выбор техники в одном месте.</p>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title} className="space-y-2">
              <p className="text-sm font-semibold">{column.title}</p>
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
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/80 pt-4 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>{currentYear} E-katalog. Все права защищены.</p>
          <p>Данные по ценам агрегируются автоматически и обновляются регулярно.</p>
        </div>
      </div>
    </footer>
  );
}
