"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Files, FilePlus2, UserRound } from "lucide-react";
import { LanguageSelector } from "@/components/layout/language-selector";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/shared/i18n";
import { ServiceStatus } from "@/features/system/client/service-status";
import { cn } from "@/lib/utils";

export function WorkspaceShell({ children, user }: { children: ReactNode; user: { name: string; email: string } }) {
  const { t } = useI18n();
  const pathname = usePathname();
  return <div className="flex min-h-screen flex-col bg-background">
    <a href="#workspace-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:p-3 focus:ring-2 focus:ring-ring">
      {t("К содержимому", "Мазмұнға өту", "Skip to content")}
    </a>
    <header className="no-print border-b bg-card">
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-2 px-4 md:gap-4 md:px-8">
        <Sheet>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="shrink-0 md:hidden" aria-label={t("Открыть меню", "Мәзірді ашу", "Open menu")}><Menu className="size-5" /></Button></SheetTrigger>
          <SheetContent side="left">
            <SheetHeader><SheetTitle>Delphi</SheetTitle><SheetDescription>{t("Контроль функций при реорганизации", "Қайта ұйымдастыру кезіндегі функцияларды бақылау", "Function review during reorganisation")}</SheetDescription></SheetHeader>
            <nav className="flex flex-col gap-2 px-4" aria-label={t("Навигация", "Навигация", "Navigation")}>
              <SheetClose asChild><Button variant="ghost" asChild className="justify-start"><Link href="/"><Files />{t("История анализов", "Талдау тарихы", "Analysis history")}</Link></Button></SheetClose>
              <SheetClose asChild><Button variant="ghost" asChild className="justify-start"><Link href="/new"><FilePlus2 />{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</Link></Button></SheetClose>
            </nav>
            <div className="mt-auto space-y-2 border-t p-4"><p className="font-medium">{user.name}</p><p className="break-all text-sm text-muted-foreground">{user.email}</p><SignOutButton /></div>
          </SheetContent>
        </Sheet>
        <Link href="/" className="shrink-0 rounded-sm text-lg font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">Delphi</Link>
        <p className="hidden max-w-60 text-sm leading-snug text-muted-foreground xl:block">{t("Контроль функций при реорганизации", "Қайта ұйымдастыру кезіндегі функцияларды бақылау", "Function review during reorganisation")}</p>
        <nav className="hidden items-center gap-3 md:flex" aria-label={t("Навигация", "Навигация", "Navigation")}>
          <Link href="/" aria-current={pathname === "/" ? "page" : undefined} className={cn("rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", pathname === "/" && "text-primary font-medium")}>
            {t("История", "Тарих", "History")}
          </Link>
          <Button asChild variant="outline" size="sm"><Link href="/new"><FilePlus2 className="size-4" aria-hidden="true" />{t("Новое сравнение", "Жаңа салыстыру", "New comparison")}</Link></Button>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
          <NotificationBell /><LanguageSelector />
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("Аккаунт", "Аккаунт", "Account")}><UserRound className="size-4" aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="space-y-1"><p className="truncate">{user.name}</p><p className="break-all text-xs font-normal text-muted-foreground">{user.email}</p></DropdownMenuLabel>
              <p className="px-2 pb-2 text-xs text-muted-foreground">{t("Общее рабочее пространство", "Ортақ жұмыс кеңістігі", "Shared workspace")}</p>
              <DropdownMenuSeparator /><SignOutButton />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
    <main id="workspace-content" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 outline-none md:px-8"><ServiceStatus />{children}</main>
  </div>;
}
