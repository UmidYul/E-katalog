import { ShoppingBag } from "lucide-react";
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
      { href: "/become-seller", label: "Become a seller" },
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
    <footer className="mt-32 border-t border-border/50 bg-secondary/20 py-20 backdrop-blur-sm">
      <div className="container space-y-16">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-6">
            <Link href="/" className="flex items-center gap-2 font-heading text-2xl font-[900] tracking-tighter">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/20">
                <ShoppingBag className="h-4 w-4 text-white" />
              </div>
              <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">Doxx</span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
              Умный агрегатор цен и характеристик. Мы помогаем делать осознанный выбор среди сотен магазинов, экономя ваше время и бюджет.
            </p>
            <div className="flex gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background border border-border/50 hover:bg-primary hover:text-white transition-all cursor-pointer hover:-translate-y-1">
                𝕏
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background border border-border/50 hover:bg-primary hover:text-white transition-all cursor-pointer hover:-translate-y-1">
                ✈️
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background border border-border/50 hover:bg-primary hover:text-white transition-all cursor-pointer hover:-translate-y-1">
                📱
              </div>
            </div>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title} className="space-y-4">
              <p className="text-[10px] font-[900] uppercase tracking-widest text-muted-foreground">{column.title}</p>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {column.links.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="transition-all hover:text-primary hover:translate-x-1 inline-block">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-6 border-t border-border/50 pt-8 md:flex-row md:items-center md:justify-between text-xs text-muted-foreground">
          <div className="space-y-1">
            <p className="font-bold text-foreground opacity-70">© {currentYear} Doxx Technology Group.</p>
            <p>Дизайн и разработка в стиле Premium SaaS Interface.</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <span>Powered by Smart Algorithms</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Service Status: Online
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

