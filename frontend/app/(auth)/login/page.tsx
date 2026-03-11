import { Suspense } from "react";

import { LoginForm } from "@/features/auth/auth-forms";
import { getRequestLocale } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";

export default function LoginPage() {
  const t = createTranslator(getRequestLocale());

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-heading text-2xl font-bold md:text-3xl">{t("pages.auth.loginTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("pages.auth.loginSubtitle")}</p>
      </div>
      <Suspense fallback={<div className="mx-auto max-w-md text-sm text-muted-foreground">{t("pages.auth.loginLoading")}</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
