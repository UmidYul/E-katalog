import { Suspense } from "react";

import { RegisterForm } from "@/features/auth/auth-forms";

export default function RegisterPage() {
  return (
    <div className="container py-10">
      <Suspense fallback={<div className="mx-auto max-w-md text-sm text-muted-foreground">Загружаем форму регистрации...</div>}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}

