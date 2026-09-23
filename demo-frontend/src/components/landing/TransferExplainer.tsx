import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Building2, Check, FileText, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import "@/styles/transfer-explainer.css";

const steps = ["Изменение", "Доказательства", "Ваше решение"];

/** A guided illustration from the synthetic transfer fixture, not an analysis run. */
export function TransferExplainer() {
  const [step, setStep] = useState(0);
  const panelId = useId();

  return (
    <section className="transfer-explainer" aria-label="Как Delphi помогает проверить изменение">
      <div className="transfer-explainer__topline">
        <span className="transfer-explainer__caption"><span aria-hidden="true" />Контрольный пример</span>
        <span className="transfer-explainer__count">{step + 1} / 3</span>
      </div>

      <div className="transfer-explainer__steps" role="group" aria-label="Шаги проверки">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className="transfer-explainer__step"
            aria-pressed={step === index}
            aria-controls={`${panelId}-${index}`}
            onClick={() => setStep(index)}
          >
            <span className="transfer-explainer__step-number">{index + 1}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="transfer-explainer__panels">
        <div id={`${panelId}-0`} className="transfer-explainer__panel" data-active={step === 0} aria-hidden={step !== 0}>
          <div className="transfer-explainer__heading">
            <span className="transfer-explainer__eyebrow">Найдите, что изменилось</span>
            <h3>Ведение реестра рисков</h3>
            <p>Та же обязанность. Новый ответственный.</p>
          </div>
          <div className="transfer-explainer__flow">
            <div className="transfer-explainer__owner">
              <span className="transfer-explainer__side">До</span>
              <Building2 aria-hidden="true" />
              <strong>Отдел<br />аудита</strong>
              <span className="transfer-explainer__source"><FileText aria-hidden="true" />Пункт 1.1</span>
            </div>
            <div className="transfer-explainer__connector" aria-hidden="true"><ArrowRight /></div>
            <div className="transfer-explainer__owner transfer-explainer__owner--after">
              <span className="transfer-explainer__side">После</span>
              <Building2 aria-hidden="true" />
              <strong>Служба<br />рисков</strong>
              <span className="transfer-explainer__source"><FileText aria-hidden="true" />Пункт 1.1</span>
            </div>
          </div>
          <div className="transfer-explainer__outcome">
            <StatusChip status="transferred" size="md" />
            <span>Функция найдена в другом документе.</span>
          </div>
        </div>

        <div id={`${panelId}-1`} className="transfer-explainer__panel" data-active={step === 1} aria-hidden={step !== 1}>
          <div className="transfer-explainer__heading">
            <span className="transfer-explainer__eyebrow">Сверьте исходные пункты</span>
            <h3>У вывода есть основание</h3>
            <p>Дословные цитаты — рядом, без поиска по файлам.</p>
          </div>
          <div className="transfer-explainer__quotes">
            <figure>
              <figcaption><FileText aria-hidden="true" /><span>До · пункт 1.1</span><span>ред. 1</span></figcaption>
              <blockquote>1.1. <mark>Отдел аудита</mark> обязан ежемесячно обновлять реестр операционных рисков всей компании.</blockquote>
            </figure>
            <figure className="transfer-explainer__quote--after">
              <figcaption><FileText aria-hidden="true" /><span>После · пункт 1.1</span><span>ред. 2</span></figcaption>
              <blockquote>1.1. <mark>Служба рисков</mark> обязана ежемесячно обновлять реестр операционных рисков всей компании.</blockquote>
            </figure>
          </div>
        </div>

        <div id={`${panelId}-2`} className="transfer-explainer__panel" data-active={step === 2} aria-hidden={step !== 2}>
          <div className="transfer-explainer__heading">
            <span className="transfer-explainer__eyebrow">Примите решение</span>
            <h3>Последнее слово — за вами</h3>
            <p>Подтвердите вывод, задайте вопрос или отклоните его.</p>
          </div>
          <div className="transfer-explainer__review">
            <div className="transfer-explainer__review-icon"><UserRoundCheck aria-hidden="true" /></div>
            <div><strong>Что проверить в этом примере</strong><p>Изменился исполнитель, а обязанность и периодичность сохранились.</p></div>
          </div>
          <div className="transfer-explainer__check"><Check aria-hidden="true" /><span>Решение человека хранится отдельно от исходного вывода.</span></div>
          <Button className="transfer-explainer__review-button" asChild>
            <Link to="/analyses/demo-transfer/review?f=risk-register-transferred-across-documents&review=all" tabIndex={step === 2 ? 0 : -1}>Проверить этот пример<ArrowUpRight aria-hidden="true" /></Link>
          </Button>
          <p className="transfer-explainer__review-note">Откроется очередь проверки готового примера.</p>
        </div>
      </div>

      <div className="transfer-explainer__footer">
        <p>Синтетический пример, подготовлен вручную.</p>
        <button type="button" onClick={() => setStep((step + 1) % steps.length)} aria-label={step < 2 ? `Далее: ${steps[step + 1]}` : "Вернуться к первому шагу"}>{step < 2 ? "Далее" : "Сначала"}<ArrowRight aria-hidden="true" /></button>
      </div>
    </section>
  );
}
