import { Suspense } from "react";

import { RegisterForm } from "@/features/auth/auth-forms";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-heading text-2xl font-bold md:text-3xl">Регистрация</h1>
        <p className="mt-2 text-sm text-muted-foreground">Создайте профиль, чтобы сохранять товары и настраивать отслеживание цен.</p>
      </div>
      <Suspense fallback={<div className="mx-auto max-w-md text-sm text-muted-foreground">Загружаем форму регистрации...</div>}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
