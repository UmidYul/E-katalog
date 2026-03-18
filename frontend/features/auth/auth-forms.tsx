"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, KeyRound, Lock, Mail, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLogin, useRegister, contactToAuthEmail, syncAnonymousStateAfterAuth } from "@/features/auth/use-auth";
import { authApi } from "@/lib/api/openapi-client";
import { type LoginFormValues, type RegisterFormValues, loginSchema, registerSchema } from "@/lib/validators/auth";
import { authStore } from "@/store/auth.store";

type LoginMode = "password" | "otp";
type RegisterStage = "form" | "verify" | "onboarding";

const roleLanding = (role: string | undefined) => {
  const normalized = String(role ?? "").trim().toLowerCase().replace("-", "_");
  if (normalized === "admin") return "/dashboard/admin";
  if (normalized === "seller") return "/dashboard/seller";
  return "/";
};

const resolveReturnUrl = (raw: string | null) => {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
};

const normalizeError = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
};

const categories = [
  { id: "smartphones", label: "Смартфонлар" },
  { id: "laptops", label: "Ноутбуклар" },
  { id: "tv", label: "Телевизорлар" },
  { id: "headphones", label: "Наушниклар" },
  { id: "all", label: "Барчаси" },
];

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();

  const returnUrl = useMemo(
    () => resolveReturnUrl(searchParams.get("returnUrl")) ?? resolveReturnUrl(searchParams.get("next")),
    [searchParams],
  );
  const fallbackReturnUrl = useMemo(() => {
    if (returnUrl) return returnUrl;
    if (typeof window === "undefined") return null;
    try {
      const ref = new URL(document.referrer);
      if (ref.origin !== window.location.origin) return null;
      const path = `${ref.pathname}${ref.search}${ref.hash}`;
      if (path.startsWith("/login") || path.startsWith("/register")) return null;
      return resolveReturnUrl(path);
    } catch {
      return null;
    }
  }, [returnUrl]);

  const [mode, setMode] = useState<LoginMode>("password");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpDebugCode, setOtpDebugCode] = useState<string | null>(null);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
      otp: "",
      rememberMe: true,
    },
  });

  const finalizeOtpLogin = async () => {
    try {
      const { data } = await authApi.me();
      authStore.getState().setSession(data);
    } catch {
      // session sync fallback
    }
    await syncAnonymousStateAfterAuth();
  };

  const requestOtp = async () => {
    const identifier = form.getValues("identifier");
    if (!identifier.trim()) {
      form.setError("identifier", { message: "Телефон ёки email киритинг" });
      return;
    }
    setSubmitError(null);
    try {
      const response = await fetch("/api/user/auth/otp-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: identifier }),
      });
      if (!response.ok) {
        throw new Error("OTP кодини юбориб бўлмади");
      }
      const payload = (await response.json()) as { debug_code?: string };
      setOtpRequested(true);
      setOtpDebugCode(payload.debug_code ?? null);
    } catch (error) {
      setSubmitError(normalizeError(error, "OTP кодини юбориб бўлмади"));
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-5 space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Кириш</h2>
        <p className="text-sm text-muted-foreground">Телефон ёки email орқали аккаунтингизга киринг.</p>
      </div>

      <div className="mb-4 inline-flex w-full items-center rounded-lg border border-border p-1">
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === "password" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          onClick={() => setMode("password")}
        >
          Парол
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === "otp" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          onClick={() => setMode("otp")}
        >
          SMS OTP
        </button>
      </div>

      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async (values) => {
          setSubmitError(null);
          const authEmail = contactToAuthEmail(values.identifier);
          if (!authEmail) {
            setSubmitError("Телефон ёки email нотўғри киритилди");
            return;
          }

          if (mode === "otp") {
            if (!values.otp?.trim()) {
              form.setError("otp", { message: "SMS кодини киритинг" });
              return;
            }
            try {
              const response = await fetch("/api/user/auth/otp-verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contact: values.identifier,
                  code: values.otp.trim(),
                  rememberMe: values.rememberMe,
                }),
              });
              if (!response.ok) throw new Error("Код нотўғри ёки муддати тугаган");
              await finalizeOtpLogin();
              router.replace(fallbackReturnUrl ?? "/");
              router.refresh();
            } catch (error) {
              setSubmitError(normalizeError(error, "OTP орқали киришда хатолик"));
            }
            return;
          }

          if (!values.password.trim()) {
            form.setError("password", { message: "Паролни киритинг" });
            return;
          }

          try {
            const { data } = await login.mutateAsync({
              email: authEmail,
              password: values.password,
              two_factor_code: twoFactorChallenge ? twoFactorCode || undefined : undefined,
              recovery_code: twoFactorChallenge ? recoveryCode || undefined : undefined,
              remember_me: values.rememberMe,
            });

            if ("requires_2fa" in data && data.requires_2fa) {
              setTwoFactorChallenge(data.challenge_token);
              setSubmitError("2FA кодини киритинг");
              return;
            }

            setTwoFactorChallenge(null);
            setTwoFactorCode("");
            setRecoveryCode("");
            const target = fallbackReturnUrl ?? roleLanding("role" in data ? data.role : undefined);
            router.replace(target);
            router.refresh();
          } catch (error) {
            setSubmitError(normalizeError(error, "Киришда хатолик юз берди"));
          }
        })}
      >
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10"
            placeholder="+998901234567 ёки email@example.com"
            {...form.register("identifier")}
          />
        </div>

        {mode === "password" ? (
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" className="pl-10" placeholder="Парол" {...form.register("password")} />
          </div>
        ) : (
          <div className="space-y-2">
            {!otpRequested ? (
              <Button type="button" variant="outline" className="w-full" onClick={requestOtp}>
                <Smartphone className="mr-2 h-4 w-4" />
                SMS код юбориш
              </Button>
            ) : null}
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-10" placeholder="SMS код" inputMode="numeric" {...form.register("otp")} />
            </div>
            {otpDebugCode ? (
              <p className="text-xs text-muted-foreground">Тест коди: <span className="font-semibold">{otpDebugCode}</span></p>
            ) : null}
          </div>
        )}

        {twoFactorChallenge ? (
          <div className="space-y-2 rounded-xl border border-border bg-secondary/30 p-3">
            <Input
              placeholder="2FA код"
              inputMode="numeric"
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value)}
            />
            <Input
              placeholder="Тиклаш коди (ихтиёрий)"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
            />
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="h-4 w-4 rounded border-border" {...form.register("rememberMe")} />
          Мени эслаб қол (30 кун)
        </label>

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? "Кирилмоқда..." : "Кириш"}
        </Button>

        {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
      </form>

      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        150 000+ фойдаланувчи нарх тушишини Doxx орқали кузатмоқда
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Аккаунт йўқми?{" "}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          Рўйхатдан ўтиш
        </Link>
      </p>
    </div>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const register = useRegister();

  const returnUrl = useMemo(
    () => resolveReturnUrl(searchParams.get("returnUrl")) ?? resolveReturnUrl(searchParams.get("next")),
    [searchParams],
  );
  const fallbackReturnUrl = useMemo(() => {
    if (returnUrl) return returnUrl;
    if (typeof window === "undefined") return null;
    try {
      const ref = new URL(document.referrer);
      if (ref.origin !== window.location.origin) return null;
      const path = `${ref.pathname}${ref.search}${ref.hash}`;
      if (path.startsWith("/login") || path.startsWith("/register")) return null;
      return resolveReturnUrl(path);
    } catch {
      return null;
    }
  }, [returnUrl]);

  const [stage, setStage] = useState<RegisterStage>("form");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [nextStepMessage, setNextStepMessage] = useState<string | null>(null);
  const [contact, setContact] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpDebugCode, setOtpDebugCode] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["all"]);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      contact: "",
      password: "",
      otp: "",
    },
  });

  const isPhoneContact = useMemo(() => !String(contact).includes("@"), [contact]);

  const requestOtp = async (value: string) => {
    const response = await fetch("/api/user/auth/otp-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact: value }),
    });
    if (!response.ok) throw new Error("SMS кодни юбориб бўлмади");
    const payload = (await response.json()) as { debug_code?: string };
    setOtpDebugCode(payload.debug_code ?? null);
  };

  const finalizeOnboarding = async () => {
    await fetch("/api/user/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interested_categories: selectedCategories.includes("all") ? ["all"] : selectedCategories,
      }),
    }).catch(() => undefined);
    await syncAnonymousStateAfterAuth();
    router.replace(fallbackReturnUrl ?? "/");
    router.refresh();
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-5 space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Рўйхатдан ўтиш</h2>
        <p className="text-sm text-muted-foreground">Фақат керакли майдонлар: телефон ёки email ва парол.</p>
      </div>

      {stage === "form" ? (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            setSubmitError(null);
            setNextStepMessage(null);
            const normalizedContact = values.contact.trim();
            const authEmail = contactToAuthEmail(normalizedContact);
            if (!authEmail) {
              setSubmitError("Телефон ёки email нотўғри");
              return;
            }

            try {
              await register.mutateAsync({
                email: authEmail,
                password: values.password,
                full_name: normalizedContact,
              });
              setContact(normalizedContact);
              if (normalizedContact.includes("@")) {
                setNextStepMessage("Email тасдиқлаш ҳаволаси юборилди. Хатни тасдиқлагандан сўнг давом этинг.");
              } else {
                await requestOtp(normalizedContact);
                setNextStepMessage("Телефонингизга SMS тасдиқлаш коди юборилди.");
              }
              setStage("verify");
            } catch (error) {
              setSubmitError(normalizeError(error, "Рўйхатдан ўтишда хатолик"));
            }
          })}
        >
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="+998901234567 ёки email@example.com"
              {...form.register("contact")}
            />
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" className="pl-10" placeholder="Парол (камида 8 белги)" {...form.register("password")} />
          </div>
          <Button type="submit" className="w-full" disabled={register.isPending}>
            {register.isPending ? "Яратилмоқда..." : "Рўйхатдан ўтиш"}
          </Button>
          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
        </form>
      ) : null}

      {stage === "verify" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-secondary/20 p-3 text-sm">{nextStepMessage}</div>

          {isPhoneContact ? (
            <>
              <Input
                placeholder="SMS код"
                inputMode="numeric"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
              />
              {otpDebugCode ? (
                <p className="text-xs text-muted-foreground">Тест коди: <span className="font-semibold">{otpDebugCode}</span></p>
              ) : null}
              <Button
                className="w-full"
                onClick={async () => {
                  setSubmitError(null);
                  try {
                    const response = await fetch("/api/user/auth/otp-verify", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ contact, code: otpCode, rememberMe: true }),
                    });
                    if (!response.ok) throw new Error("Код нотўғри");
                    setStage("onboarding");
                  } catch (error) {
                    setSubmitError(normalizeError(error, "Кодни тасдиқлаб бўлмади"));
                  }
                }}
              >
                SMS кодни тасдиқлаш
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={() => setStage("onboarding")}>
              Email тасдиқладим
            </Button>
          )}
          {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
        </div>
      ) : null}

      {stage === "onboarding" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            Қайси категориялар сизни қизиқтиради?
          </div>
          <div className="space-y-2">
            {categories.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(item.id)}
                  onChange={(event) => {
                    setSelectedCategories((prev) => {
                      if (event.target.checked) {
                        if (item.id === "all") return ["all"];
                        return prev.filter((entry) => entry !== "all").concat(item.id);
                      }
                      const next = prev.filter((entry) => entry !== item.id);
                      return next.length ? next : ["all"];
                    });
                  }}
                  className="h-4 w-4 rounded border-border"
                />
                {item.label}
              </label>
            ))}
          </div>

          <Button className="w-full" onClick={finalizeOnboarding}>
            Давом этиш
          </Button>
        </div>
      ) : null}

      <div className="mt-5 space-y-2 text-xs text-muted-foreground">
        <p className="inline-flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Қўшимча исм ва хабарнома созламалари кейин сўралади.</p>
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Аккаунт борми?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Кириш
        </Link>
      </p>
    </div>
  );
}
