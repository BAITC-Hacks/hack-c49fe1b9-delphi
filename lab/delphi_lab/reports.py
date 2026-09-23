"""Read-only exports of saved findings, evidence and the current human review."""
from collections import Counter
import csv
from copy import deepcopy
from difflib import SequenceMatcher
from html import escape
import io
import json
import re

from .storage import Store
from .validation import materialize_evidence

LABELS = {
    'ru': {
        'title': 'Лаборатория Delphi', 'draft': 'Проект заключения · требуется проверка человеком',
        'intro': 'Сравнение структуры и обязанностей по предоставленному комплекту документов.',
        'sources': 'Документы и источники', 'structure': 'Подразделения и роли',
        'findings': 'Обязанности и вопросы', 'conclusion': 'Заключение', 'diff': 'Текстовые различия',
        'limits': 'Границы анализа', 'before': 'До', 'after': 'После', 'print': 'Печать / PDF',
        'no_ai': 'Выполнен только разбор и текстовое сравнение. AI-анализ ещё не запускался.',
        'none': 'Сохранённых AI-выводов нет. Это не означает отсутствия проблем.',
        'confirmed': 'Подтверждено', 'unreviewed': 'Не проверено', 'rejected': 'Отклонено',
        'needs_clarification': 'Нужно уточнение', 'review': 'Проверка', 'action': 'Рекомендация',
        'evidence': 'Основание', 'context': 'Родительский контекст', 'trace': 'Операции и расход API',
        'first_listed': 'Извлечено только после — соответствие требует проверки', 'before_only': 'Извлечено только до — требуется сопоставление',
        'both': 'Перечислено с обеих сторон', 'search': 'Запросы поиска соответствия',
        'rejected_section': 'Отклонённые выводы (исключены из замечаний)', 'note': 'Заметка человека',
        'issue_count': 'Замечания, ещё не отклонённые', 'next': 'Проверьте основания и отметьте решение по каждому выводу.',
        'incomplete': 'Анализ не завершён. Часть источников или обязанностей не проверена. Количество замечаний не отражает полный результат.',
    },
    'kk': {
        'title': 'Delphi зертханасы', 'draft': 'Қорытынды жобасы · адам тексеруі қажет',
        'intro': 'Берілген құжаттар жиынтығы бойынша құрылым мен міндеттерді салыстыру.',
        'sources': 'Құжаттар мен дереккөздер', 'structure': 'Бөлімшелер мен рөлдер',
        'findings': 'Міндеттер мен сұрақтар', 'conclusion': 'Қорытынды', 'diff': 'Мәтіндік айырмашылықтар',
        'limits': 'Талдау шектеулері', 'before': 'Дейін', 'after': 'Кейін', 'print': 'Басып шығару / PDF',
        'no_ai': 'Тек құжаттарды оқу және мәтіндерді салыстыру орындалды. AI талдауы әлі іске қосылған жоқ.',
        'none': 'Сақталған AI тұжырымдары жоқ. Бұл мәселелер жоқ дегенді білдірмейді.',
        'confirmed': 'Расталды', 'unreviewed': 'Тексерілмеген', 'rejected': 'Қабылданбады',
        'needs_clarification': 'Нақтылау қажет', 'review': 'Тексеру', 'action': 'Ұсыныс',
        'evidence': 'Негіздеме', 'context': 'Жоғары тұрған тармақтың мәнмәтіні', 'trace': 'Әрекеттер және API шығыны',
        'first_listed': 'Тек кейінгі нұсқадан алынды — сәйкестікті тексеру қажет', 'before_only': 'Тек алдыңғы нұсқадан алынды — салыстыру қажет',
        'both': 'Екі нұсқада да көрсетілген', 'search': 'Сәйкестікті іздеу сұраулары',
        'rejected_section': 'Қабылданбаған тұжырымдар', 'note': 'Адамның ескертпесі',
        'issue_count': 'Қабылданбағандардан басқа ескертулер', 'next': 'Негіздемелерді тексеріп, әр тұжырым бойынша шешімді белгілеңіз.',
        'incomplete': 'Талдау аяқталған жоқ. Кейбір дереккөздер немесе міндеттер тексерілмеген. Ескертулер саны толық нәтижені көрсетпейді.',
    },
    'en': {
        'title': 'Delphi laboratory', 'draft': 'Draft conclusion · human review required',
        'intro': 'Structure and responsibility comparison of the supplied document sets.',
        'sources': 'Documents and sources', 'structure': 'Units and roles', 'findings': 'Duties and questions',
        'conclusion': 'Conclusion', 'diff': 'Text differences', 'limits': 'Analysis limits',
        'before': 'Before', 'after': 'After', 'print': 'Print / PDF',
        'no_ai': 'Parsing and text comparison only. AI analysis has not been run.',
        'none': 'No saved AI findings. This does not establish the absence of issues.',
        'confirmed': 'Confirmed', 'unreviewed': 'Unreviewed', 'rejected': 'Rejected',
        'needs_clarification': 'Needs clarification', 'review': 'Review', 'action': 'Recommendation',
        'evidence': 'Evidence', 'context': 'Parent context', 'trace': 'Operations and API usage',
        'first_listed': 'Extracted only in After — correspondence unverified', 'before_only': 'Extracted only in Before — requires matching',
        'both': 'Listed on both sides', 'search': 'Correspondence search queries',
        'rejected_section': 'Rejected findings (excluded from issues)', 'note': 'Human note',
        'issue_count': 'Issues not yet rejected', 'next': 'Review the evidence and record a decision for each finding.',
        'incomplete': 'Analysis is incomplete. Some sources or duties have not been reviewed. The issue count is not the full result.',
    },
}


def inline_diff(before: str, after: str) -> str:
    """Escaped word diff for display; the authoritative quotations stay separate."""
    left = re.findall(r'\s+|\S+', before)
    right = re.findall(r'\s+|\S+', after)
    parts = []
    for operation, i, j, k, l in SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if operation == 'equal':
            parts.append(escape(''.join(left[i:j])))
        else:
            if operation in ('delete', 'replace'):
                parts.append('<del>' + escape(''.join(left[i:j])) + '</del>')
            if operation in ('insert', 'replace'):
                parts.append('<ins>' + escape(''.join(right[k:l])) + '</ins>')
    return ''.join(parts)


def localized_run(store: Store, run_id: str, lang: str, snapshot: dict | None = None) -> dict:
    if lang not in LABELS:
        raise ValueError('Supported report languages: ru, kk, en')
    run = deepcopy(snapshot) if snapshot is not None else store.run(run_id)
    if lang != run['output_language'] and run['findings']:
        translation = store.translation(run_id, run['review_revision'], lang)
        if translation is None:
            raise ValueError('Translation for this review revision is not saved. Request translation first.')
        items = {f['id']: f for f in translation['findings']}
        for finding in run['findings']:
            for field in ('title', 'explanation', 'recommendation'):
                finding[field] = items[finding['id']][field]
    return run


def render_report(store: Store, run_id: str, lang: str = 'ru', snapshot: dict | None = None) -> str:
    run = localized_run(store, run_id, lang, snapshot)
    documents = store.documents(run_id)
    sources = {b.id: b.model_dump() for doc in documents for b in doc.blocks}
    doc_names = {doc.id: doc.filename for doc in documents}
    labels = LABELS[lang]
    e = lambda value: escape(str(value), quote=True)
    t = lambda key: e(labels.get(key, key))

    def source_quote(source_id: str, excerpt: str | None = None, context: bool = True) -> str:
        block = sources[source_id]
        text = block['original_text'] if excerpt is None else excerpt
        html = (f'<div class="source {e(block["side"])}"><small>{t(block["side"])} · '
                f'{e(doc_names[block["document_id"]])} · {e(block["locator"])}</small>'
                f'<blockquote>{e(text)}</blockquote><code>{e(source_id)}</code>')
        parent = block.get('parent_id')
        visited = {source_id}
        if context and parent:
            html += f'<details><summary>{t("context")}</summary>'
            while parent in sources and parent not in visited:
                visited.add(parent)
                html += source_quote(parent, context=False)
                parent = sources[parent].get('parent_id')
            html += '</details>'
        return html + '</div>'

    def finding_card(f: dict) -> str:
        refs = materialize_evidence(f, sources)
        status = f['review']['status']
        return (f'<article id="{e(f["id"])}"><div class="tags"><span>{e(f["change_type"])}</span>'
                f'<span>{e(f["issue_type"])}</span><span>{t(status)}</span></div>'
                f'<h3>{e(f["title"])}</h3><p>{e(f["explanation"])}</p>'
                f'<p><strong>{t("action")}:</strong> {e(f["recommendation"])}</p>'
                f'<div class="evidence">' + ''.join(source_quote(r['source_id'], r['excerpt']) for r in refs) + '</div>'
                + (f'<p>{t("search")}: {e("; ".join(f["search_queries"]))}</p>' if f['search_queries'] else '')
                + (f'<p>{t("note")}: {e(f["review"]["note"])}</p>' if f['review']['note'] else '')
                + '</article>')

    active = [f for f in run['findings'] if f['review']['status'] != 'rejected']
    rejected = [f for f in run['findings'] if f['review']['status'] == 'rejected']
    issues = [f for f in active if f['issue_type'] != 'none']
    counts = Counter(f['review']['status'] for f in run['findings'])
    html = f'''<!doctype html><html lang="{e(lang)}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{t('title')}</title>
<style>
:root{{color-scheme:light;--ink:#16282c;--line:#d4e1dd;--green:#185d4b;--muted:#556b66}}
*{{box-sizing:border-box}}body{{margin:0;background:#f4f6f1;color:var(--ink);font:16px/1.65 system-ui,sans-serif}}
header,main{{max-width:1200px;margin:auto;padding:30px}}header{{padding-top:50px}}h1{{font-size:42px;line-height:1.12;letter-spacing:-1.4px;margin:12px 0}}
h2{{font-size:26px}}h3{{line-height:1.35}}nav{{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}}a,button{{color:var(--green)}}
nav a,button,.tags span{{padding:5px 12px;border:1px solid var(--line);border-radius:6px;text-decoration:none;background:white}}
section{{margin-bottom:38px}}article,.panel{{background:white;padding:24px;border:1px solid var(--line);border-radius:10px;margin:16px 0}}
.tags{{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted)}}.eyebrow{{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--green)}}
.notice{{border-left:4px solid #bf852b;background:#fff4db;padding:16px 22px;margin-top:16px}}.evidence{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}}
.source{{padding:14px;margin:8px 0;background:#f5f7f7;border-left:3px solid #879b9b;overflow-wrap:anywhere}}.source.after{{border-color:#2e8c6a}}
blockquote{{margin:12px 0;white-space:pre-wrap}}code,pre{{font-size:12px;overflow-wrap:anywhere;white-space:pre-wrap}}small{{color:var(--muted)}}
del{{background:#ffe0de;color:#8b302a}}ins{{background:#d8f1e1;color:#175b39;text-decoration:none}}.redline{{white-space:pre-wrap;margin:16px 0}}
details{{margin:12px 0}}summary{{cursor:pointer}}table{{width:100%;border-collapse:collapse}}td,th{{padding:10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}}
.counts{{display:flex;gap:24px;flex-wrap:wrap}}.counts strong{{font-size:30px;display:block}}footer{{color:var(--muted);font-size:13px;padding:24px 0}}
@media print{{nav,button{{display:none}}body{{background:white}}header,main{{padding:10px}}article{{break-inside:avoid}}details> *{{display:block}}}}
</style><header><div class="eyebrow">DELPHI / LAB · {e(run['mode'])} · {e(run['state'])}</div>
<h1>{t('title')}</h1><p>{t('intro')}</p><div class="notice">{t('draft')}</div>
<nav>{''.join(f'<a href="#{key}">{t(key)}</a>' for key in ['sources','diff','structure','findings','conclusion'])}</nav>
<button onclick="window.print()">{t('print')}</button></header><main>'''
    if run['mode'] == 'preprocess':
        html += f'<div class="notice">{t("no_ai")}</div>'
    if run['state'] not in {'completed', 'prepared'}:
        html += f'<div class="notice"><strong>{t("incomplete")}</strong></div>'
    html += f'<section id="sources"><h2>{t("sources")}</h2><div class="panel"><table>'
    for doc in documents:
        html += f'<tr><td>{t(doc.side)}</td><td>{e(doc.filename)}<br><small>SHA256 {e(doc.sha256)}</small></td><td>{doc.format.upper()} · {len(doc.blocks)} blocks<br>{e(doc.parse_status)}</td></tr>'
    html += '</table></div></section>'
    diff = run['diff']
    summary = {k: v for k, v in diff.items() if k not in ('rows', 'after_without_candidate_ids')}
    html += f'<section id="diff"><h2>{t("diff")}</h2><div class="panel"><pre>{e(json.dumps(summary, ensure_ascii=False, indent=2))}</pre>'
    ordered_rows = sorted(diff.get('rows', []), key=lambda row: row.get('status') == 'exact_text')
    exact_section = False
    for row in ordered_rows:
        if row.get('status') == 'exact_text' and not exact_section:
            html += '<details><summary>Exact text candidates — roles and context can still change</summary>'
            exact_section = True
        before_id = row['before_source_id']
        html += f'<details><summary>{e(row["status"])} · {e(sources[before_id]["clause_no"] or sources[before_id]["locator"])}</summary><div class="evidence">'
        html += source_quote(before_id)
        for candidate in row.get('candidates', []):
            html += source_quote(candidate['after_source_id'])
        html += '</div>'
        if row.get('candidates') and row['status'] != 'exact_text':
            first_id = row['candidates'][0]['after_source_id']
            html += '<div class="redline">' + inline_diff(sources[before_id]['original_text'], sources[first_id]['original_text']) + '</div>'
        html += '</details>'
    if exact_section:
        html += '</details>'
    after_ids = diff.get('after_without_candidate_ids', [])
    if after_ids:
        html += '<details><summary>After: no lexical candidate (not a semantic addition claim)</summary>'
        html += ''.join(source_quote(sid) for sid in after_ids) + '</details>'
    html += '</div></section>'
    html += f'<section id="structure"><h2>{t("structure")}</h2><div class="panel">'
    groups = {}
    for unit in run['units']:
        key = (unit['name_original'].casefold().strip(), unit['kind'])
        groups.setdefault(key, []).append(unit)
    if not groups:
        html += f'<p>{t("none")}</p>'
    for units in groups.values():
        sides = {u['side'] for u in units}
        label = 'both' if len(sides) == 2 else 'first_listed' if 'after' in sides else 'before_only'
        html += f'<details><summary>{e(units[0]["name_original"])} · {e(units[0]["kind"])} · {t(label)}</summary>'
        html += ''.join(source_quote(sid) for u in units for sid in u['source_ids']) + '</details>'
    html += '</div></section>'
    html += f'<section id="findings"><h2>{t("findings")}</h2>'
    html += ''.join(finding_card(f) for f in active) or f'<div class="panel">{t("none")}</div>'
    if rejected:
        html += f'<details><summary>{t("rejected_section")}</summary>' + ''.join(finding_card(f) for f in rejected) + '</details>'
    html += '</section>'
    html += f'<section id="conclusion"><h2>{t("conclusion")}</h2><div class="panel"><div class="counts">'
    html += f'<div><strong>{len(issues)}</strong>{t("issue_count")}</div>'
    html += ''.join(f'<div><strong>{counts[s]}</strong>{t(s)}</div>' for s in ('confirmed', 'unreviewed', 'needs_clarification', 'rejected'))
    html += f'</div><p>{t("next") if active else t("none")}</p><ul>'
    html += ''.join(f'<li><a href="#{e(f["id"])}">{e(f["title"])}</a> — {e(f["recommendation"])}</li>' for f in issues)
    html += f'</ul></div><h3>{t("limits")}</h3><ul>'
    html += ''.join(f'<li>{e(item)}</li>' for item in run['limitations'] + run['errors'])
    html += f'</ul><details><summary>Coverage</summary><pre>{e(json.dumps(run["coverage"], ensure_ascii=False, indent=2))}</pre></details>'
    html += f'<details><summary>{t("trace")}</summary><pre>{e(json.dumps({"usage": run["usage"], "trace": run["trace"]}, ensure_ascii=False, indent=2))}</pre></details></section>'
    html += f'<footer>{e(run_id)} · review_revision={run["review_revision"]} · {e(run["pipeline_version"])} · {e(run["model"])}<br>{e(run["finished_at"])}</footer></main></html>'
    return html


def functions_csv(store: Store, run_id: str, snapshot: dict | None = None) -> str:
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    fields = ['id', 'side', 'actor_original', 'action', 'object', 'scope', 'condition', 'modality', 'source_ids']
    writer.writerow(fields)
    run = snapshot if snapshot is not None else store.run(run_id)
    for function in run['functions']:
        values = []
        for field in fields:
            value = function[field]
            text = '; '.join(value) if isinstance(value, list) else str(value)
            # CSV opened in spreadsheets must not execute source text as a formula.
            values.append("'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text)
        writer.writerow(values)
    return '\ufeff' + output.getvalue()
