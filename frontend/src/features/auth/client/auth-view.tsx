"use client";

import { LanguageSelector } from "@/components/layout/language-selector";
import { useI18n } from "@/shared/i18n";
import { AuthCard } from "./auth-card";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

export function AuthView({ mode }: { mode: "sign-in" | "sign-up" }) {
  const { t } = useI18n();
  const signingIn = mode === "sign-in";

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="flex justify-end"><LanguageSelector /></div>
      <AuthCard
        title={signingIn ? t("Вход", "Кіру", "Sign in") : t("Создать аккаунт", "Аккаунт ашу", "Create an account")}
        description={signingIn
          ? t("Войдите в рабочее пространство Delphi.", "Delphi жұмыс кеңістігіне кіріңіз.", "Use your Delphi workspace account to continue.")
          : t("Создайте аккаунт для работы в Delphi.", "Delphi-де жұмыс істеу үшін аккаунт ашыңыз.", "Set up access to the Delphi workspace.")}
      >
        {signingIn ? <SignInForm /> : <SignUpForm />}
      </AuthCard>
    </div>
  );
}
