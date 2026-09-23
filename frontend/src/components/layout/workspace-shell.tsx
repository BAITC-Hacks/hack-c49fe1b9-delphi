"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Menu, Files, FilePlus2 } from "lucide-react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { LanguageSelector } from "@/components/layout/language-selector";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/shared/i18n";
import { ServiceStatus } from "@/features/system/client/service-status";

export function WorkspaceShell({ children, user }: { children: ReactNode; user: { name: string; email: string } }) {
  const { t } = useI18n();
  return <div className="min-h-screen bg-background md:flex">
    <AppSidebar user={user} />
    <div className="min-w-0 flex-1">
      <header className="flex h-16 items-center justify-between gap-3 border-b bg-card px-4 md:px-8">
        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label={t("Открыть меню", "Мәзірді ашу", "Open menu")}><Menu className="size-5" /></Button></SheetTrigger>
            <SheetContent side="left">
              <SheetHeader><SheetTitle>Delphi</SheetTitle><SheetDescription>{t("Общее рабочее пространство", "Ортақ жұмыс кеңістігі", "Shared workspace")}</SheetDescription></SheetHeader>
              <nav className="flex flex-col gap-2 px-4">
                <SheetClose asChild><Button variant="ghost" asChild className="justify-start"><Link href="/"><Files />{t("История анализов", "Талдау тарихы", "Analysis history")}</Link></Button></SheetClose>
                <SheetClose asChild><Button variant="ghost" asChild className="justify-start"><Link href="/new"><FilePlus2 />{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</Link></Button></SheetClose>
              </nav>
              <div className="mt-auto space-y-2 border-t p-4"><p className="font-medium">{user.name}</p><p className="break-all text-sm text-muted-foreground">{user.email}</p><SignOutButton /></div>
            </SheetContent>
          </Sheet>
          <span className="font-semibold md:hidden">Delphi</span>
          <span className="hidden text-sm text-muted-foreground md:inline">{t("Общее рабочее пространство", "Ортақ жұмыс кеңістігі", "Shared workspace")}</span>
        </div>
        <div className="flex items-center gap-2"><NotificationBell /><LanguageSelector /></div>
      </header>
      <main className="mx-auto w-full max-w-7xl p-4 md:p-8"><ServiceStatus />{children}</main>
    </div>
  </div>;
}
