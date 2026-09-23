"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/shared/i18n";
import { clearNotifications, toast } from "@/shared/notifications";
import { confirm } from "@/components/custom-ui/confirm-nice-dialog";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    try {
      if (!(await confirm({ title: t("Выйти из аккаунта?", "Аккаунттан шығасыз ба?", "Sign out?"), description: t("Текущая сессия будет завершена.", "Ағымдағы сессия аяқталады.", "Your current session will end."), confirmLabel: t("Выйти", "Шығу", "Sign out"), cancelLabel: t("Отмена", "Бас тарту", "Cancel") }))) {
        return;
      }

      const { error } = await signOut();
      if (error) {
        toast.error(t("Не удалось выйти. Повторите попытку.", "Шығу мүмкін болмады. Қайталап көріңіз.", "Unable to sign out. Please try again."));
        return;
      }
      clearNotifications();
      router.replace("/sign-in");
      router.refresh();
    } catch {
      toast.error(t("Нет соединения. Проверьте сеть и повторите попытку.", "Байланыс жоқ. Желіні тексеріп, қайталап көріңіз.", "Unable to connect. Check your connection and try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={pending} className="w-full justify-start">
      <LogOut className="size-4" aria-hidden="true" />
      {pending ? t("Выход…", "Шығу…", "Signing out…") : t("Выйти", "Шығу", "Sign out")}
    </Button>
  );
}
