"use client";

import { useI18n } from "@/shared/i18n";
import { diffWords } from "../model/evidence";

export function WordDiff({ before, after }: { before: string; after: string }) {
  const { t } = useI18n();
  const parts = diffWords(before, after);
  return <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t("Различия слов", "Сөз айырмашылықтары", "Word differences")}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <h5 className="font-medium uppercase tracking-wide text-muted-foreground">{t("Различия слов", "Сөз айырмашылықтары", "Word differences")}</h5>
      <p className="text-muted-foreground"><del className="bg-status-missing-bg text-status-missing-fg">{t("Было в «До»", "«Дейін» болды", "Removed from Before")}</del>{" · "}<ins className="bg-status-new-bg text-status-new-fg underline">{t("Появилось в «После»", "«Кейін» қосылды", "Added in After")}</ins></p>
    </div>
    {parts === null ? <p className="text-sm text-muted-foreground">{t("Пункты слишком длинные для пословного сравнения. Исходные тексты показаны выше.", "Тармақтар сөз бойынша салыстыруға тым ұзын. Бастапқы мәтіндер жоғарыда көрсетілген.", "These clauses exceed the word-comparison limit. Original text remains available above.")}</p> : parts.every((part) => part.kind === "same") ? <p className="text-sm">{t("Тексты совпадают дословно. Смена исполнителя или номера проверяется отдельно.", "Мәтіндер сөзбе-сөз сәйкес. Орындаушының не нөмірдің өзгеруі бөлек тексеріледі.", "The texts match exactly. Changes of owner or clause number are assessed separately.")}</p> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{parts.map((part, index) => part.kind === "same" ? <span key={index}>{part.text}</span> : part.kind === "del" ? <del key={index} className="rounded-sm bg-status-missing-bg text-status-missing-fg">{part.text}</del> : <ins key={index} className="rounded-sm bg-status-new-bg text-status-new-fg underline decoration-2 underline-offset-2">{part.text}</ins>)}</p>}
    <p className="text-xs text-muted-foreground">{t("Сравниваются слова в этих двух исходных пунктах. Удалённое слово само по себе не доказывает потерю функции.", "Осы екі бастапқы тармақтың сөздері салыстырылады. Сөздің жойылуы функцияның жоғалғанын дәлелдемейді.", "This compares wording in these two original clauses. A removed word alone does not prove a lost duty.")}</p>
  </section>;
}
