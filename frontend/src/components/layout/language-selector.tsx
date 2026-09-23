"use client";

import { Languages } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n, type Locale } from "@/shared/i18n";

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  return <div className="flex items-center gap-2">
    <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
    <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      <SelectTrigger className="w-24" size="sm" aria-label={t("Язык интерфейса", "Интерфейс тілі", "Interface language")}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="ru">RU</SelectItem><SelectItem value="kk">ҚАЗ</SelectItem><SelectItem value="en">EN</SelectItem></SelectContent>
    </Select>
  </div>;
}
