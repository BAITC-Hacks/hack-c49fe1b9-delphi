"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useI18n } from "@/shared/i18n";
import { toast } from "@/shared/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";
import { createSignUpSchema, type SignUpInput } from "@/features/auth/model";

export function SignUpForm() {
  const router = useRouter();
  const { t } = useI18n();
  const form = useForm<SignUpInput>({
    resolver: zodResolver(createSignUpSchema(t)),
    defaultValues: { name: "", email: "", password: "" },
  });

  async function onSubmit(values: SignUpInput) {
    form.clearErrors("root");
    try {
      const { error } = await signUp.email({ ...values, callbackURL: "/" });
      if (error) {
        form.setError("root", { message: error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" || error.code === "USER_ALREADY_EXISTS"
          ? t("Этот email уже зарегистрирован. Войдите в аккаунт.", "Бұл email тіркелген. Аккаунтқа кіріңіз.", "This email is already registered. Sign in instead.")
          : t("Не удалось создать аккаунт. Повторите попытку.", "Аккаунт ашу мүмкін болмады. Қайталап көріңіз.", "Unable to create the account. Please try again.") });
        return;
      }

      toast.success(t("Аккаунт создан.", "Аккаунт ашылды.", "Account created."));
      router.replace("/");
      router.refresh();
    } catch {
      form.setError("root", { message: t("Нет соединения. Проверьте сеть и повторите попытку.", "Байланыс жоқ. Желіні тексеріп, қайталап көріңіз.", "Unable to connect. Check your connection and try again.") });
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">{t("Имя", "Аты", "Name")}</Label>
        <Input id="name" autoComplete="name" maxLength={100} aria-invalid={Boolean(form.formState.errors.name)} aria-describedby={form.formState.errors.name ? "name-error" : undefined} disabled={form.formState.isSubmitting} {...form.register("name")} />
        {form.formState.errors.name ? <p id="name-error" className="text-xs text-destructive">{form.formState.errors.name.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("Электронная почта", "Электрондық пошта", "Email")}</Label>
        <Input id="email" type="email" autoComplete="email" aria-invalid={Boolean(form.formState.errors.email)} aria-describedby={form.formState.errors.email ? "email-error" : undefined} disabled={form.formState.isSubmitting} {...form.register("email")} />
        {form.formState.errors.email ? <p id="email-error" className="text-xs text-destructive">{form.formState.errors.email.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("Пароль", "Құпиясөз", "Password")}</Label>
        <Input id="password" type="password" autoComplete="new-password" maxLength={128} aria-invalid={Boolean(form.formState.errors.password)} aria-describedby={form.formState.errors.password ? "password-hint password-error" : "password-hint"} disabled={form.formState.isSubmitting} {...form.register("password")} />
        <p id="password-hint" className="text-xs text-muted-foreground">{t("Не менее 8 символов.", "Кемінде 8 таңба.", "At least 8 characters.")}</p>
        {form.formState.errors.password ? <p id="password-error" className="text-xs text-destructive">{form.formState.errors.password.message}</p> : null}
      </div>
      {form.formState.errors.root ? <p role="alert" className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
      <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? t("Создание аккаунта…", "Аккаунт ашылуда…", "Creating account…") : t("Создать аккаунт", "Аккаунт ашу", "Create account")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("Уже есть аккаунт?", "Аккаунтыңыз бар ма?", "Already have an account?")}{" "}
        <Link className="font-medium text-primary hover:underline" href="/sign-in">
          {t("Войти", "Кіру", "Sign in")}
        </Link>
      </p>
    </form>
  );
}
