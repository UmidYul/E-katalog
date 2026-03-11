"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { CheckCircle, Lock, Mail, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Button, buttonVariants } from "@/components/ui/button";
import { useT } from "@/components/common/locale-provider";
import { Input } from "@/components/ui/input";
import { env } from "@/config/env";
import { useLogin, useRegister } from "@/features/auth/use-auth";
import { authApi } from "@/lib/api/openapi-client";
import { cn } from "@/lib/utils/cn";
import { type LoginFormValues, type RegisterFormValues, loginSchema, registerSchema } from "@/lib/validators/auth";

const extractErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
};

const buildOAuthStartUrl = (provider: "google" | "facebook", nextPath: string) =>
  `${env.apiOrigin}${env.apiPrefix}/auth/oauth/${provider}?next=${encodeURIComponent(nextPath || "/profile")}`;

const roleLanding = (role: string | undefined) => {
  const normalized = String(role ?? "").trim().toLowerCase().replace("-", "_");
  if (normalized === "admin") return "/dashboard/admin";
  if (normalized === "seller") return "/dashboard/seller";
  return "/";
};

function SocialAuthButtons({ nextPath }: { nextPath: string }) {
  const t = useT("authForm");
  const providersQuery = useQuery({
    queryKey: ["auth", "oauth-providers"],
    queryFn: async () => {
      const { data } = await authApi.oauthProviders();
      return data.providers;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const providers = useMemo(() => {
    const fallback = ["google", "facebook"] as const;
    if (!providersQuery.data) {
      return fallback.map((id) => ({ id, title: id === "google" ? t("loginGoogle") : t("loginFacebook") }));
    }
    return providersQuery.data
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.provider as "google" | "facebook",
        title: provider.provider === "google" ? t("loginGoogle") : t("loginFacebook"),
      }));
  }, [providersQuery.data, t]);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <a key={provider.id} href={buildOAuthStartUrl(provider.id, nextPath)} className={cn(buttonVariants({ variant: "outline" }), "w-full rounded-lg")}>
          {provider.title}
        </a>
      ))}
    </div>
  );
}

export function LoginForm() {
  const t = useT("authForm");
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

  const form = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-stretch">
      {/* Left panel */}
      <div className="hidden flex-col justify-between bg-accent p-12 text-white lg:flex lg:w-[420px] lg:shrink-0">
        <div>
          <p className="text-2xl font-bold tracking-tight">Doxx</p>
          <p className="mt-1 text-sm text-white/60">{t("leftTagline")}</p>
        </div>
        <div className="space-y-6">
          {[
            { icon: CheckCircle, text: t("leftFeature1") },
            { icon: CheckCircle, text: t("leftFeature2") },
            { icon: CheckCircle, text: t("leftFeature3") },
          ].map((item) => (
            <div key={item.text} className="flex items-start gap-3">
              <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-white/70" />
              <p className="text-sm leading-relaxed text-white/80">{item.text}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} Doxx</p>
      </div>

      {/* Right: form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="mb-8">
            <h1 className="font-heading text-2xl font-bold text-foreground">{t("loginTitle")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("loginSubtitle")}</p>
          </div>

          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              setSubmitError(null);
              try {
                const { data } = await login.mutateAsync({
                  email: values.email,
                  password: values.password,
                  two_factor_code: challengeToken ? twoFactorCode || undefined : undefined,
                  recovery_code: challengeToken ? recoveryCode || undefined : undefined,
                });

                if ("requires_2fa" in data && data.requires_2fa) {
                  setChallengeToken(data.challenge_token);
                  setSubmitError(t("twoFaPrompt"));
                  return;
                }

                setChallengeToken(null);
                setTwoFactorCode("");
                setRecoveryCode("");
                const redirectTarget = next ?? roleLanding("role" in data ? data.role : undefined);
                router.replace(redirectTarget);
                router.refresh();
              } catch (error) {
                setSubmitError(extractErrorMessage(error, t("requestError")));
              }
            })}
          >
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("emailPlaceholder")} className="pl-10" {...form.register("email")} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" placeholder={t("passwordPlaceholder")} className="pl-10" {...form.register("password")} />
            </div>

            {challengeToken ? (
              <>
                <Input placeholder={t("twoFaCodePlaceholder")} inputMode="numeric" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value)} />
                <Input placeholder={t("recoveryCodePlaceholder")} value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
              </>
            ) : null}

            <Button type="submit" variant="accent" className="w-full" disabled={login.isPending}>
              {login.isPending ? t("loginPending") : challengeToken ? t("confirmTwoFa") : t("loginButton")}
            </Button>

            {submitError && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-destructive">
                {submitError}
              </motion.p>
            )}
            {!submitError && oauthError ? <p className="text-sm text-destructive">{t("oauthError", { error: oauthError })}</p> : null}

            <div className="relative my-2 flex items-center gap-3">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-muted-foreground">{t("or")}</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <SocialAuthButtons nextPath={next ?? "/"} />

            <p className="pt-1 text-center text-sm text-muted-foreground">
              {t("noAccount")}{" "}
              <Link href="/register" className="font-semibold text-accent hover:underline">
                {t("signUp")}
              </Link>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
}

export function RegisterForm() {
  const t = useT("authForm");
  const router = useRouter();
  const register = useRegister();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", fullName: "", password: "", confirmPassword: "" },
  });

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-stretch">
      {/* Left panel */}
      <div className="hidden flex-col justify-between bg-accent p-12 text-white lg:flex lg:w-[420px] lg:shrink-0">
        <div>
          <p className="text-2xl font-bold tracking-tight">Doxx</p>
          <p className="mt-1 text-sm text-white/60">{t("leftTagline")}</p>
        </div>
        <div className="space-y-8">
          <div>
            <p className="text-3xl font-bold leading-snug">{t("registerHeroTitle")}</p>
          </div>
          <p className="text-sm text-white/70">{t("registerHeroText")}</p>
        </div>
        <p className="text-xs text-white/40">© {new Date().getFullYear()} Doxx</p>
      </div>

      {/* Right: form */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="mb-8">
            <h1 className="font-heading text-2xl font-bold text-foreground">{t("registerTitle")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("registerSubtitle")}</p>
          </div>

          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              setSubmitError(null);
              try {
                await register.mutateAsync({ email: values.email, password: values.password, full_name: values.fullName });
                router.push("/profile");
              } catch (error) {
                setSubmitError(extractErrorMessage(error, t("requestError")));
              }
            })}
          >
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("fullNamePlaceholder")} className="pl-10" {...form.register("fullName")} />
            </div>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t("emailPlaceholder")} className="pl-10" {...form.register("email")} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" placeholder={t("passwordPlaceholder")} className="pl-10" {...form.register("password")} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" placeholder={t("confirmPasswordPlaceholder")} className="pl-10" {...form.register("confirmPassword")} />
            </div>

            <Button type="submit" variant="accent" className="w-full" disabled={register.isPending}>
              {register.isPending ? t("registerPending") : t("registerButton")}
            </Button>

            {submitError && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-destructive">
                {submitError}
              </motion.p>
            )}

            <div className="relative my-2 flex items-center gap-3">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-muted-foreground">{t("or")}</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <SocialAuthButtons nextPath="/profile" />

            <p className="pt-1 text-center text-sm text-muted-foreground">
              {t("hasAccount")}{" "}
              <Link href="/login" className="font-semibold text-accent hover:underline">
                {t("signIn")}
              </Link>
            </p>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
