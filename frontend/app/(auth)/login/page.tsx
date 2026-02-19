import { LoginForm } from "@/features/auth/auth-forms";
import { Suspense } from "react";

export default function LoginPage() {
  return (
    <div className="container py-10">
      <Suspense fallback={<div className="mx-auto max-w-md text-sm text-muted-foreground">Loading sign in...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

