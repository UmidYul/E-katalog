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

const roleLanding = (role: string | undefined) => {
  const normalized = String(role ?? "").trim().toLowerCase().replace("-", "_");
  if (normalized === "admin") return "/dashboard/admin";
  if (normalized === "seller") return "/dashboard/seller";
  return "/";
};

import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User, Github, Chrome, Facebook, ArrowRight, ShieldCheck, Fingerprint } from "lucide-react";

export function SocialAuthButtons({ nextPath }: { nextPath: string }) {
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
      return fallback.map((id) => ({ id, title: id === "google" ? "Google" : "Facebook" }));
    }
    return providersQuery.data
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.provider as "google" | "facebook",
        title: provider.provider === "google" ? "Google" : "Facebook"
      }));
  }, [providersQuery.data]);

  if (providers.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {providers.map((provider) => (
        <a
          key={provider.id}
          href={buildOAuthStartUrl(provider.id, nextPath)}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-12 w-full rounded-2xl border-2 font-bold transition-all hover:bg-secondary/50 hover:border-primary/20 flex gap-2"
          )}
        >
          {provider.id === "google" ? <Chrome className="h-4 w-4" /> : <Facebook className="h-4 w-4" />}
          {provider.title}
        </a>
      ))}
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNext = searchParams.get("next");
  const next = requestedNext && requestedNext.startsWith("/") ? requestedNext : null;
  const oauthError = searchParams.get("oauth_error");
  const login = useLogin();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative mx-auto mt-10 max-w-lg"
    >
      {/* Decorative background element */}
      <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
      <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-secondary/10 blur-3xl" />

      <Card className="relative overflow-hidden rounded-[2.5rem] border-border/40 bg-card/80 p-6 shadow-2xl backdrop-blur-xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Fingerprint className="h-8 w-8" />
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-3xl font-[900] tracking-tight">Добро пожаловать</h1>
            <p className="text-sm font-medium text-muted-foreground">Войдите в свой аккаунт для доступа к мониторингу цен</p>
          </div>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-6"
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
                  setSubmitError("Введите код из приложения-аутентификатора.");
                  return;
                }

                setChallengeToken(null);
                const redirectTarget = next ?? roleLanding("role" in data ? data.role : undefined);
                router.replace(redirectTarget);
                router.refresh();
              } catch (error) {
                setSubmitError(extractErrorMessage(error));
              }
            })}
          >
            <div className="space-y-4">
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  placeholder="Email адрес"
                  className="h-12 rounded-2xl border-2 pl-12 focus-visible:ring-primary/20 transition-all font-medium"
                  {...form.register("email")}
                />
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  type="password"
                  placeholder="Пароль"
                  className="h-12 rounded-2xl border-2 pl-12 focus-visible:ring-primary/20 transition-all font-medium"
                  {...form.register("password")}
                />
              </div>

              <AnimatePresence>
                {challengeToken && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4 pt-2"
                  >
                    <div className="relative group">
                      <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                      <Input
                        placeholder="Код 2FA (6 цифр)"
                        inputMode="numeric"
                        className="h-12 rounded-2xl border-primary/30 border-2 pl-12 bg-primary/5 font-black tracking-widest"
                        value={twoFactorCode}
                        onChange={(event) => setTwoFactorCode(event.target.value)}
                      />
                    </div>
                    <Input
                      placeholder="Recovery code"
                      className="h-12 rounded-2xl border-2 pl-12"
                      value={recoveryCode}
                      onChange={(event) => setRecoveryCode(event.target.value)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-3">
              <Button type="submit" className="h-14 w-full rounded-[1.5rem] text-base font-bold shadow-xl shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.98]" disabled={login.isPending}>
                {login.isPending ? (
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin border-2 border-white/30 border-t-white rounded-full" />
                    Выполняем вход...
                  </div>
                ) : challengeToken ? "Подтвердить" : "Войти в аккаунт"}
              </Button>

              {submitError && (
                <p className="rounded-xl bg-destructive/10 p-3 text-center text-xs font-bold text-destructive animate-in fade-in slide-in-from-top-2">
                  {submitError}
                </p>
              )}
            </div>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/60"></div></div>
              <div className="relative flex justify-center text-[10px] font-black uppercase tracking-widest text-muted-foreground"><span className="bg-card px-3">или войти через</span></div>
            </div>

            <SocialAuthButtons nextPath={next ?? "/"} />

            <div className="text-center pt-2">
              <p className="text-sm font-medium text-muted-foreground">
                Нет аккаунта?{" "}
                <Link href="/register" className="font-bold text-primary hover:underline underline-offset-4">
                  Создать аккаунт
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mx-auto mt-10 max-w-lg"
    >
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 h-40 w-full rounded-full bg-primary/5 blur-3xl -z-10" />

      <Card className="rounded-[2.5rem] border-border/40 bg-card/80 p-6 shadow-2xl backdrop-blur-xl overflow-hidden">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground shadow-inner">
            <User className="h-8 w-8" />
          </div>
          <div className="space-y-1">
            <h1 className="font-heading text-3xl font-[900] tracking-tight">Регистрация</h1>
            <p className="text-sm font-medium text-muted-foreground leading-relaxed">Начните экономить время и деньги уже сегодня</p>
          </div>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-6"
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
            <div className="space-y-4">
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input placeholder="Имя и фамилия" className="h-12 rounded-2xl border-2 pl-12" {...form.register("fullName")} />
              </div>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input placeholder="Email адрес" className="h-12 rounded-2xl border-2 pl-12" {...form.register("email")} />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="password" placeholder="Пароль" className="h-12 rounded-2xl border-2 pl-12" {...form.register("password")} />
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="password" placeholder="Повтор" className="h-12 rounded-2xl border-2 pl-12" {...form.register("confirmPassword")} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Button type="submit" className="h-14 w-full rounded-[1.5rem] text-base font-bold shadow-xl shadow-primary/20" disabled={register.isPending}>
                {register.isPending ? "Создание профиля..." : "Зарегистрироваться"}
              </Button>
              {submitError && <p className="text-center text-xs font-bold text-destructive">{submitError}</p>}
            </div>

            <div className="text-center pt-2">
              <p className="text-sm font-medium text-muted-foreground">
                Уже есть аккаунт?{" "}
                <Link href="/login" className="font-bold text-primary hover:underline underline-offset-4">
                  Войти в систему
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
