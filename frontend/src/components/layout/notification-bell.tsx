"use client";

import { Bell, CircleCheck, CircleAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/shared/i18n";
import { clearNotifications, markNotificationsRead, useNotifications } from "@/shared/notifications";

export function NotificationBell() {
  const items = useNotifications();
  const { locale, t } = useI18n();
  const unread = items.filter((item) => !item.read).length;
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) markNotificationsRead(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("Уведомления", "Хабарламалар", "Notifications")}>
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{unread}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between gap-3">
          {t("Уведомления", "Хабарламалар", "Notifications")}
          <Button variant="ghost" size="sm" onClick={clearNotifications} disabled={!items.length}>{t("Очистить", "Тазалау", "Clear")}</Button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-auto" role="log" aria-live="polite">
          {!items.length && <p className="p-4 text-sm text-muted-foreground">{t("Новых событий нет", "Жаңа оқиғалар жоқ", "No new events")}</p>}
          {items.map((item) => {
            const Icon = item.kind === "success" ? CircleCheck : item.kind === "error" ? CircleAlert : Info;
            return <div key={item.id} className="flex gap-3 border-b p-3 last:border-0">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0"><p className="break-words text-sm">{item.message}</p><time className="text-xs text-muted-foreground">{item.createdAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</time></div>
            </div>;
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
