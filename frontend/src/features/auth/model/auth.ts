import { z } from "zod";

type Translate = (ru: string, kk: string, en: string) => string;

export function createSignInSchema(t: Translate) {
  return z.object({
    email: z.string().trim().toLowerCase().pipe(z.email(t("Введите корректный email.", "Дұрыс email енгізіңіз.", "Enter a valid email address."))),
    password: z.string()
      .min(1, t("Введите пароль.", "Құпиясөзді енгізіңіз.", "Enter your password."))
      .max(128, t("Пароль слишком длинный.", "Құпиясөз тым ұзын.", "Password is too long.")),
  });
}

export function createSignUpSchema(t: Translate) {
  return createSignInSchema(t).extend({
    name: z.string().trim()
      .min(1, t("Введите имя.", "Атыңызды енгізіңіз.", "Enter your name."))
      .max(100, t("Имя слишком длинное.", "Аты тым ұзын.", "Name is too long.")),
    password: z.string()
      .min(8, t("Пароль должен содержать не менее 8 символов.", "Құпиясөз кемінде 8 таңбадан тұруы керек.", "Password must contain at least 8 characters."))
      .max(128, t("Пароль слишком длинный.", "Құпиясөз тым ұзын.", "Password is too long.")),
  });
}

export function signInDestination(requested: string | null): string {
  if (!requested?.startsWith("/") || requested.startsWith("//") || requested.includes("\\")) {
    return "/";
  }
  const target = new URL(requested, "http://delphi.local");
  if (target.origin !== "http://delphi.local") return "/";
  return `${target.pathname}${target.search}${target.hash}`;
}

export type SignInInput = z.infer<ReturnType<typeof createSignInSchema>>;
export type SignUpInput = z.infer<ReturnType<typeof createSignUpSchema>>;
