import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowRightLeft, Check, ChevronDown, Copy, FileCheck2, FileText, SearchX, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TransferExplainer } from "@/components/landing/TransferExplainer";
import { DEMO_ONLY } from "@/lib/demo";
import "@/styles/landing.css";

const questions = [
  { icon: ArrowRightLeft, tone: "transfer", label: "Передача функции", title: "Кто теперь отвечает?", description: "Обязанность могла перейти в другое подразделение или другой документ. Найдите нового исполнителя.", link: "/analyses/demo-transfer/review?f=risk-register-transferred-across-documents&review=all" },
  { icon: SearchX, tone: "missing", label: "Соответствие не найдено", title: "Что требует уточнения?", description: "Посмотрите, для каких обязанностей не найдено соответствие в комплекте «После». Это повод проверить, а не вывод об отмене.", link: "/analyses/demo-missing/review?f=risk-register-missing&review=all" },
  { icon: Copy, tone: "overlap", label: "Возможное дублирование", title: "Где ответственность пересекается?", description: "Уточните роли, когда одна и та же задача закреплена сразу за несколькими подразделениями.", link: "/analyses/demo-overlap/review?f=exclusive-duty-duplicated&review=all" },
  { icon: TriangleAlert, tone: "conflict", label: "Возможный конфликт", title: "Какие требования несовместимы?", description: "Проверьте противоречия в порядке действий и возможные конфликты интересов по исходным пунктам.", link: "/analyses/demo-conflict/review?f=incompatible-approval-sequence&review=all" },
];

const faqs = [
  { question: "Для кого Delphi?", answer: "Для сотрудников, которые проверяют распределение обязанностей при реорганизации: внутреннего аудита, внутреннего контроля и организационного развития. Для работы с примерами специальные технические знания не нужны." },
  { question: "Если соответствие не найдено, функция отменена?", answer: "Нет. Функция могла перейти к другому исполнителю, изменить формулировку или оказаться в документе, которого нет в комплекте. Delphi показывает основание для проверки. Если полнота поиска неизвестна, вы увидите предупреждение." },
  { question: "Можно ли проверить, откуда взялся вывод?", answer: "Да. У вывода можно открыть исходные пункты с номером и редакцией документа. Нужный фрагмент выделен, длинный пункт раскрывается целиком. Вы можете сопоставить формулировки перед решением." },
  { question: "Что доступно в этой версии?", answer: DEMO_ONLY ? "Готовые результаты на обезличенных документах и отдельно помеченных синтетических примерах. Модель здесь не запускается, ваши файлы не загружаются. Решения проверяющего сохраняются в этом браузере; заключение можно экспортировать." : "Загрузка комплектов «До» и «После», запуск анализа, проверка выводов по источникам и экспорт заключения. Также доступны готовые примеры для знакомства с интерфейсом." },
];

export default function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = pageRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08 });
    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
      element.classList.add("will-reveal");
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="delphi-landing" ref={pageRef}>
      <a className="landing-skip" href="#landing-main">К содержанию</a>
      <header className="landing-header">
        <div className="landing-container landing-nav">
          <Link to="/" className="landing-brand" aria-label="Delphi — главная">
            <span className="landing-brand-mark" aria-hidden="true"><span /><span /><span /></span>
            Delphi<span className="landing-brand-caption">ясность в изменениях</span>
          </Link>
          <nav aria-label="О продукте" className="landing-nav-links">
            <a href="#questions">Что проверяет</a><a href="#how-it-works">Как работает</a><a href="#faq">Вопросы</a>
          </nav>
          <Button asChild className="landing-nav-cta"><Link to="/new">{DEMO_ONLY ? "Открыть демо" : "Начать"}<ArrowRight aria-hidden="true" /></Link></Button>
        </div>
      </header>

      <main id="landing-main">
        <section className="landing-container landing-hero" aria-labelledby="hero-title">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow"><span /> Контроль функций при реорганизации</p>
            <h1 id="hero-title">Кто теперь<br />за что <span>отвечает?</span></h1>
            <p className="landing-lead">Delphi сравнивает положения «До» и «После». Показывает, кому передали обязанности, где не найдено соответствие и что стоит проверить.</p>
            <div className="landing-hero-actions">
              <Button asChild size="lg" className="landing-primary"><Link to={DEMO_ONLY ? "/analyses/demo-transfer/review?f=risk-register-transferred-across-documents&review=all" : "/new"}>{DEMO_ONLY ? "Посмотреть на примере" : "Начать сравнение"}<ArrowRight aria-hidden="true" /></Link></Button>
              <a href="#how-it-works" className="landing-text-link">Как это работает <ArrowDown size={16} aria-hidden="true" /></a>
            </div>
            <p className="landing-demo-note"><span aria-hidden="true" />{DEMO_ONLY ? "Демо на готовых результатах. Ваши файлы не нужны." : "Каждый вывод можно проверить по исходному документу."}</p>
          </div>
          <div className="landing-hero-visual"><TransferExplainer /></div>
        </section>

        <div className="landing-container landing-assurances" aria-label="Принципы работы">
          <div><FileText aria-hidden="true" /><span>Выводы с исходными пунктами</span></div>
          <div><ShieldCheck aria-hidden="true" /><span>Решение остаётся за вами</span></div>
          <div><FileCheck2 aria-hidden="true" /><span>Заключение с вашими отметками</span></div>
        </div>

        <section id="questions" className="landing-container landing-section" aria-labelledby="questions-title">
          <div className="landing-section-heading" data-reveal>
            <p className="landing-eyebrow">Четыре вопроса вместо сотен страниц</p>
            <h2 id="questions-title">Сразу к тому,<br />что требует внимания.</h2>
            <p>Изменение номера пункта ещё не означает изменение обязанности. Проверьте смысл, исполнителя и условия.</p>
          </div>
          <div className="landing-question-grid">
            {questions.map(({ icon: Icon, tone, label, title, description, link }, index) => (
              <article key={tone} className={`landing-question landing-tone-${tone}`} data-reveal>
                <div className="landing-question-top"><span className="landing-question-icon"><Icon size={23} aria-hidden="true" /></span><span className="landing-question-number">0{index + 1}</span></div>
                <p className="landing-status-label">{label}</p>
                <h3>{title}</h3><p className="landing-question-description">{description}</p>
                <Link to={link} className="landing-case-link">Разобрать пример <ArrowRight size={16} aria-hidden="true" /><span className="sr-only">: {label}</span></Link>
              </article>
            ))}
          </div>
          <p className="landing-section-note">Эти четыре примера — синтетические учебные материалы. Результаты подготовлены заранее.</p>
        </section>

        <section id="how-it-works" className="landing-workflow" aria-labelledby="workflow-title">
          <div className="landing-container landing-workflow-grid">
            <div data-reveal>
              <p className="landing-eyebrow">Простой путь к решению</p>
              <h2 id="workflow-title">Проверьте по пунктам.<br /><span>Решите по существу.</span></h2>
              <ol className="landing-steps">
                <li><span className="landing-step-number">01</span><div><h3>{DEMO_ONLY ? "Откройте пример" : "Добавьте документы"}</h3><p>{DEMO_ONLY ? "Выберите готовое сравнение: реальные обезличенные редакции или контрольный кейс." : "Добавьте комплекты «До» и «После», чтобы сопоставить обязанности между документами."}</p></div></li>
                <li><span className="landing-step-number">02</span><div><h3>Сверьте вывод с источником</h3><p>Посмотрите, что изменилось, кто отвечает за функцию и какими пунктами это подтверждается.</p></div></li>
                <li><span className="landing-step-number">03</span><div><h3>Отметьте решение и сохраните итог</h3><p>Подтвердите вывод, оставьте вопрос или отклоните его. Ваши отметки и заметки попадут в заключение.</p></div></li>
              </ol>
            </div>
            <div className="landing-report-wrap" data-reveal>
              <div className="landing-report">
                <div className="landing-report-head"><span className="landing-report-icon"><FileCheck2 size={23} aria-hidden="true" /></span><span>Результат вашей проверки<br /><small>Понятная структура заключения</small></span></div>
                <h3>Не просто список изменений.<br />Основание для следующего шага.</h3>
                <ul>
                  <li><Check aria-hidden="true" /><div><strong>Что изменилось</strong><span>Обязанность и её исполнитель</span></div></li>
                  <li><Check aria-hidden="true" /><div><strong>На чём основан вывод</strong><span>Редакции, пункты и исходный текст</span></div></li>
                  <li><Check aria-hidden="true" /><div><strong>Что решил проверяющий</strong><span>Подтверждение, вопрос или отклонение</span></div></li>
                </ul>
                <div className="landing-report-foot"><ShieldCheck size={18} aria-hidden="true" /><p>До проверки человеком это проект заключения. Delphi помогает разобраться; окончательное решение принимаете вы.</p></div>
              </div>
              <p className="landing-workflow-note">Заключение доступно для экспорта в HTML и печати.</p>
            </div>
          </div>
        </section>

        <section id="faq" className="landing-container landing-faq landing-section" aria-labelledby="faq-title">
          <div data-reveal><p className="landing-eyebrow">Без сложных объяснений</p><h2 id="faq-title">Перед первым<br />сравнением.</h2><p className="landing-faq-intro">Что важно знать о выводах,<br />источниках и этой версии.</p></div>
          <div className="landing-faq-items" data-reveal>{faqs.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={19} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
        </section>

        <section className="landing-container landing-final" aria-labelledby="final-title" data-reveal>
          <div><p className="landing-eyebrow">Начните с одного изменения</p><h2 id="final-title">Посмотрите, как функция<br />переходит к другому исполнителю.</h2><p>Один понятный пример: обязанность, два пункта и ваше решение.</p></div>
          <Button asChild size="lg" className="landing-primary"><Link to="/analyses/demo-transfer/review?f=risk-register-transferred-across-documents&review=all">Открыть пример<ArrowRight aria-hidden="true" /></Link></Button>
        </section>
      </main>

      <footer className="landing-container landing-footer"><Link to="/" className="landing-footer-brand">Delphi</Link><p>Ясность в документах. Ответственность в решениях.</p><Link to="/history">История анализов <ArrowRight size={14} aria-hidden="true" /></Link></footer>
    </div>
  );
}
