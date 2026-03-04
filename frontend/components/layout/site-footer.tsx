import Link from "next/link";
import { Send, Youtube } from "lucide-react";

const footerLinks = {
  Каталог: [
    { href: "/catalog", label: "Все товары" },
    { href: "/compare", label: "Сравнение" },
    { href: "/favorites", label: "Избранное" },
  ],
  Аккаунт: [
    { href: "/profile", label: "Профиль" },
    { href: "/recently-viewed", label: "Недавно просмотренные" },
    { href: "/login", label: "Вход" },
  ],
  Сервис: [
    { href: "/become-seller", label: "Стать продавцом" },
    { href: "/status", label: "Статус сервиса" },
    { href: "/contacts", label: "Контакты" },
  ],
  Правовая: [
    { href: "/privacy", label: "Privacy Policy" },
    { href: "/terms", label: "Terms of Service" },
    { href: "/cookies", label: "Cookie Policy" },
  ],
};

const paymentMethods = ["Visa", "Mastercard", "МИР", "SBP"];

export function SiteFooter() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-4 font-heading text-sm font-bold">{title}</h3>
              <ul className="flex flex-col gap-2">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-primary-foreground/65 transition-colors hover:text-accent">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <hr className="my-8 border-primary-foreground/10" />

        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-3">
            <span className="text-sm text-primary-foreground/65">Мы в соцсетях:</span>
            <div className="flex gap-2">
              <a
                href="#"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground/10 text-primary-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="VK"
              >
                <span className="text-xs font-bold">VK</span>
              </a>
              <a
                href="#"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground/10 text-primary-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="Telegram"
              >
                <Send className="h-4 w-4" />
              </a>
              <a
                href="#"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-foreground/10 text-primary-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="YouTube"
              >
                <Youtube className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {paymentMethods.map((method) => (
              <span key={method} className="rounded-md border border-primary-foreground/20 px-2.5 py-1 text-xs font-medium text-primary-foreground/70">
                {method}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-primary-foreground/45">
          © {year} Doxx. Все права защищены.
        </div>
      </div>
    </footer>
  );
}
