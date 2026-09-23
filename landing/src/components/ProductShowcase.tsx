import { useId, useRef, useState } from "react";
import { ArrowRight, ArrowRightLeft, FileSearch, Maximize2, UserRoundCheck, X } from "lucide-react";
import transferImage from "../assets/screenshots/05-transfer-evidence.png";
import reviewImage from "../assets/screenshots/06-review-queue.png";
import modalityImage from "../assets/screenshots/09-modality-word-diff.png";
import "../styles/product-showcase.css";

const views = [
  {
    label: "Передача функции",
    icon: ArrowRightLeft,
    image: transferImage,
    alt: "Экран Delphi: функция из пункта 5.4.4 редакции 8 найдена в пункте 5.3.3 редакции 9. Рядом показаны исходные цитаты и изменившиеся исполнители.",
    title: "Обязанность сохранилась. Исполнитель изменился.",
    description: "Два исходных пункта рядом: видно, на чём основан вывод о передаче.",
  },
  {
    label: "Проверка человеком",
    icon: UserRoundCheck,
    image: reviewImage,
    alt: "Очередь проверки Delphi: вопросы слева, исходные пункты справа. Сотрудник может подтвердить вывод, задать вопрос или отклонить его и добавить заметку.",
    title: "Один вопрос — все основания для решения.",
    description: "Сверьте цитаты, добавьте заметку и подтвердите, уточните или отклоните вывод.",
  },
  {
    label: "Изменение обязательности",
    icon: FileSearch,
    image: modalityImage,
    alt: "Экран Delphi: пункт 9.15 в двух редакциях. Формулировка «осуществляется» изменилась на «может осуществляться»; различия слов выделены.",
    title: "Одно слово может изменить смысл обязанности.",
    description: "В пункте 9.15 «осуществляется» заменено на «может осуществляться». Разница выделена в тексте.",
  },
];

function ScreenshotEnlarge({ view }: { view: typeof views[number] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const zoom = useRef<HTMLDivElement>(null);
  const id = useId();
  return <>
    <button className="product-showcase__enlarge" type="button" onClick={() => {
      dialog.current?.showModal();
      if (zoom.current) {
        zoom.current.scrollTop = 0;
        zoom.current.scrollLeft = window.innerWidth <= 540 && view.image === transferImage ? zoom.current.scrollWidth * 0.4 : 0;
      }
    }} aria-haspopup="dialog"><Maximize2 aria-hidden="true" />Рассмотреть крупнее</button>
    <dialog className="product-showcase__dialog" ref={dialog} aria-labelledby={`${id}-dialog-title`} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="product-showcase__dialog-bar">
        <div><h3 id={`${id}-dialog-title`}>{view.label}</h3><p>На небольшом экране изображение можно прокручивать.</p></div>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Закрыть изображение" autoFocus><X aria-hidden="true" /></button>
      </div>
      <div className="product-showcase__zoom" ref={zoom} tabIndex={0} aria-label="Увеличенный экран Delphi. Используйте прокрутку для просмотра."><img src={view.image} alt={view.alt} width="1440" height="1000" /></div>
    </dialog>
  </>;
}

export function ProductHero() {
  return <figure className="product-hero">
    <div className="product-hero__bar"><span><FileSearch aria-hidden="true" />Реальные обезличенные документы</span><span className="product-hero__status"><ArrowRightLeft aria-hidden="true" />Передана</span></div>
    <div className="product-hero__image"><img src={transferImage} alt={views[0].alt} width="1440" height="1000" fetchPriority="high" /><ScreenshotEnlarge view={views[0]} /></div>
    <figcaption><span><small>Редакция 8</small><strong>п. 5.4.4</strong></span><ArrowRight aria-hidden="true" /><span><small>Редакция 9</small><strong>п. 5.3.3</strong></span></figcaption>
  </figure>;
}

export function ProductShowcase() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const current = views[selected];

  return (
    <section className="product-showcase" aria-labelledby={`${id}-heading`}>
      <div className="product-showcase__intro">
        <span className="product-showcase__eyebrow">Не просто сравнение текста</span>
        <h2 id={`${id}-heading`}>Передана — не потеряна.</h2>
        <p>Функция из пункта 5.4.4 редакции 8 нашлась в пункте 5.3.3 редакции 9 — уже у другого исполнителя. Delphi показывает связь и исходные цитаты, чтобы вы могли её проверить.</p>
        <div className="product-showcase__source-link" aria-label="Пункт 5.4.4 редакции 8 связан с пунктом 5.3.3 редакции 9">
          <span><small>Редакция 8</small><strong>п. 5.4.4</strong></span>
          <ArrowRight aria-hidden="true" />
          <span><small>Редакция 9</small><strong>п. 5.3.3</strong></span>
        </div>
      </div>

      <div className="product-showcase__frame">
        <div className="product-showcase__views" role="group" aria-label="Посмотреть возможности Delphi">
          {views.map((view, index) => {
            const Icon = view.icon;
            return (
              <button key={view.label} type="button" aria-pressed={selected === index} aria-controls={`${id}-preview`} onClick={() => setSelected(index)}>
                <Icon aria-hidden="true" /><span>{view.label}</span>
              </button>
            );
          })}
        </div>
        <div className="product-showcase__images" id={`${id}-preview`}>
          {views.map((view, index) => <img key={view.image} src={view.image} alt={selected === index ? view.alt : ""} aria-hidden={selected !== index} data-active={selected === index} width="1440" height="1000" loading="lazy" decoding="async" />)}
          <ScreenshotEnlarge view={current} />
        </div>
        <div className="product-showcase__caption" aria-live="polite" aria-atomic="true">
          <strong>{current.title}</strong>
          <p>{current.description}</p>
        </div>
      </div>
      <p className="product-showcase__note">Экраны демонстрационного примера на обезличенных редакциях 8 и 9. Выводы требуют проверки сотрудником.</p>
    </section>
  );
}
