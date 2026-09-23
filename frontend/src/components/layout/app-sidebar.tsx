"use client";

import { FilePlus2, Files, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/shared/i18n";

export function AppSidebar({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const navigation = [
    { href: "/", label: t("История анализов", "Талдау тарихы", "Analysis history"), icon: Files },
    { href: "/new", label: t("Новое сравнение", "Жаңа салыстыру", "New comparison"), icon: FilePlus2 },
  ];

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="rounded-lg bg-primary p-2 text-primary-foreground">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="font-semibold tracking-tight">Delphi</p>
          <p className="text-xs text-muted-foreground">{t("Проверка реорганизации", "Қайта ұйымдастыруды тексеру", "Reorganisation review")}</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label={t("Навигация", "Навигация", "Navigation")}>
        {navigation.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              pathname === href && "bg-accent text-accent-foreground"
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-3">
        <p className="truncate px-3 text-sm font-medium">{user.name}</p>
        <p className="truncate px-3 pb-3 text-xs text-muted-foreground">{user.email}</p>
        <SignOutButton />
      </div>
    </aside>
  );
}
