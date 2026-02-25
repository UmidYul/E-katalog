"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { env } from "@/config/env";
import { useLogin, useRegister } from "@/features/auth/use-auth";
import { authApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { type LoginFormValues, type RegisterFormValues, loginSchema, registerSchema } from "@/lib/validators/auth";

const extractErrorMessage = (error: unknown) => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Не удалось выполнить запрос. Проверьте данные и попробуйте снова.";
};

const buildOAuthStartUrl = (provider: "google" | "facebook", nextPath: string) =>
  `${env.apiOrigin}${env.apiPrefix}/auth/oauth/${provider}?next=${encodeURIComponent(nextPath || "/profile")}`;

function SocialAuthButtons({ nextPath }: { nextPath: string }) {
  const providersQuery = useQuery({
    queryKey: ["auth", "oauth-providers"],
    queryFn: async () => {
      const { data } = await authApi.oauthProviders();
      return data.providers;
    },
    retry: false,
    staleTime: 5 * 60 * 1000
  });

  const providers = useMemo(() => {
    const fallback = ["google", "facebook"] as const;
    if (!providersQuery.data) {
      return fallback.map((id) => ({ id, title: id === "google" ? "Войти через Google" : "Войти через Facebook" }));
    }
    return providersQuery.data
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.provider as "google" | "facebook",
        title: provider.provider === "google" ? "Войти через Google" : "Войти через Facebook"
      }));
  }, [providersQuery.data]);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <a key={provider.id} href={buildOAuthStartUrl(provider.id, nextPath)} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
          {provider.title}
        </a>
      ))}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/profile";
  const oauthError = searchParams.get("oauth_error");
  const login = useLogin();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const form = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  return (
    <Card className="mx-auto max-w-md border-border/80">
      <CardHeader className="space-y-1">
        <CardTitle className="font-heading text-xl">Вход в аккаунт</CardTitle>
        <p className="text-sm text-muted-foreground">Сравнивайте цены, сохраняйте избранное и отслеживайте изменение стоимости.</p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setSubmitError(null);
            try {
              const { data } = await login.mutateAsync({
                email: values.email,
                password: values.password,
                two_factor_code: challengeToken ? twoFactorCode || undefined : undefined,
                recovery_code: challengeToken ? recoveryCode || undefined : undefined
              });

              if ("requires_2fa" in data && data.requires_2fa) {
                setChallengeToken(data.challenge_token);
                setSubmitError("Введите код из приложения-аутентификатора или recovery code.");
                return;
              }

              setChallengeToken(null);
              setTwoFactorCode("");
              setRecoveryCode("");
              router.replace(next);
              router.refresh();
            } catch (error) {
              setSubmitError(extractErrorMessage(error));
            }
          })}
        >
          <Input placeholder="Email" {...form.register("email")} />
          <Input type="password" placeholder="Пароль" {...form.register("password")} />

          {challengeToken ? (
            <>
              <Input
                placeholder="Код 2FA (6 цифр)"
                inputMode="numeric"
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
              />
              <Input placeholder="Recovery code (если нет 2FA-кода)" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} />
            </>
          ) : null}

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? "Выполняем вход..." : challengeToken ? "Подтвердить 2FA" : "Войти"}
          </Button>
          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          {!submitError && oauthError ? <p className="text-sm text-destructive">OAuth ошибка: {oauthError}</p> : null}

          <div className="pt-1">
            <p className="mb-2 text-center text-xs text-muted-foreground">или</p>
            <SocialAuthButtons nextPath={next} />
          </div>

          <Link href="/register" className={cn(buttonVariants({ variant: "ghost" }), "w-full")}>
            Создать аккаунт
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const register = useRegister();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", fullName: "", password: "", confirmPassword: "" }
  });

  return (
    <Card className="mx-auto max-w-md border-border/80">
      <CardHeader className="space-y-1">
        <CardTitle className="font-heading text-xl">Регистрация</CardTitle>
        <p className="text-sm text-muted-foreground">Создайте профиль, чтобы сохранять товары и настраивать отслеживание цен.</p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setSubmitError(null);
            try {
              await register.mutateAsync({ email: values.email, password: values.password, full_name: values.fullName });
              router.push("/profile");
            } catch (error) {
              setSubmitError(extractErrorMessage(error));
            }
          })}
        >
          <Input placeholder="Имя и фамилия" {...form.register("fullName")} />
          <Input placeholder="Email" {...form.register("email")} />
          <Input type="password" placeholder="Пароль" {...form.register("password")} />
          <Input type="password" placeholder="Подтверждение пароля" {...form.register("confirmPassword")} />
          <Button type="submit" className="w-full" disabled={register.isPending}>
            {register.isPending ? "Создаем аккаунт..." : "Зарегистрироваться"}
          </Button>
          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}

          <div className="pt-1">
            <p className="mb-2 text-center text-xs text-muted-foreground">или</p>
            <SocialAuthButtons nextPath="/profile" />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
