"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { signInDestination, createSignInSchema, type SignInInput } from "@/features/auth/model";

export function SignInForm() {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const form = useForm<SignInInput>({
    resolver: zodResolver(createSignInSchema(t)),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: SignInInput) {
    form.clearErrors("root");
    const destination = signInDestination(searchParams.get("next"));
    try {
      const { error } = await signIn.email({
        email: values.email,
        password: values.password,
        callbackURL: destination,
      });
      if (error) {
        form.setError("root", { message: error.status === 401
          ? t("Неверный email или пароль.", "Email немесе құпиясөз қате.", "Invalid email or password.")
          : t("Не удалось войти. Повторите попытку.", "Кіру мүмкін болмады. Қайталап көріңіз.", "Unable to sign in. Please try again.") });
        return;
      }

      toast.success(t("Вы вошли в аккаунт.", "Аккаунтқа кірдіңіз.", "Signed in."));
      router.replace(destination as Route);
      router.refresh();
    } catch {
      form.setError("root", { message: t("Нет соединения. Проверьте сеть и повторите попытку.", "Байланыс жоқ. Желіні тексеріп, қайталап көріңіз.", "Unable to connect. Check your connection and try again.") });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">{t("Электронная почта", "Электрондық пошта", "Email")}</Label>
        <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} aria-describedby={form.formState.errors.email ? "email-error" : undefined} disabled={form.formState.isSubmitting} {...form.register("email")} />
        {form.formState.errors.email ? <p id="email-error" className="text-xs text-destructive">{form.formState.errors.email.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("Пароль", "Құпиясөз", "Password")}</Label>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={Boolean(form.formState.errors.password)} aria-describedby={form.formState.errors.password ? "password-error" : undefined} disabled={form.formState.isSubmitting} {...form.register("password")} />
        {form.formState.errors.password ? <p id="password-error" className="text-xs text-destructive">{form.formState.errors.password.message}</p> : null}
      </div>
      {form.formState.errors.root ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
      <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("Вход…", "Кіру…", "Signing in…") : t("Войти", "Кіру", "Sign in")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("Впервые в Delphi?", "Delphi-ге алғаш келдіңіз бе?", "New to Delphi?")}{" "}
        <Link className="font-medium text-primary hover:underline" href="/sign-up">
          {t("Создать аккаунт", "Аккаунт ашу", "Create an account")}
        </Link>
      </p>
    </form>
  );
}
