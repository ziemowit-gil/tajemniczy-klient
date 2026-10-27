const path = require('node:path');
const PDFDocument = require('pdfkit');
const { ANSWER_OPTIONS, NOT_APPLICABLE } = require('../domain/scoring');
const { AREA_LABELS } = require('../domain/constants');
const { STATUS_LABELS } = require('../domain/workflow');

const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const pct = (p) => (p === null || p === undefined ? 'brak danych' : `${String(p).replace('.', ',')}%`);

function answerLabel(item) {
  if (item.answer === null || item.answer === undefined || item.answer === '') return 'Brak odpowiedzi';
  if (item.answer === NOT_APPLICABLE) return 'Nie dotyczy';
  return ANSWER_OPTIONS[item.answerType].find((o) => o.value === item.answer)?.label ?? item.answer;
}

/** Zabezpiecza komórkę przed „wstrzyknięciem formuły” w Excelu/LibreOffice i cytuje ją zgodnie z RFC 4180. */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
const BOM = '﻿'; // Excel poprawnie rozpoznaje wtedy UTF-8 (polskie znaki)

function auditCsv(report) {
  const { audit, items, summary, attachments } = report;
  const files = new Map();
  for (const a of attachments) files.set(a.audit_item_id, [...(files.get(a.audit_item_id) || []), a.original_name]);
  const { score } = summary;

  const rows = [
    ['Raport z audytu dostępności'],
    ['Obiekt', audit.object_name],
    ['Scenariusz', audit.scenario_title],
    ['Audytor', audit.auditor_name],
    ['Status', STATUS_LABELS[audit.status] + (report.preliminary ? ' (raport wstępny)' : '')],
    ['Wynik ogólny', pct(score.total.percent)],
    [AREA_LABELS.OZN, pct(score.areas.OZN.percent)],
    [AREA_LABELS.KSZTALCENIE, pct(score.areas.KSZTALCENIE.percent)],
    [],
    ['Obszar', 'Kategoria', 'Kod', 'Kryterium', 'Waga', 'Odpowiedź', 'Komentarz', 'Załączniki'],
    ...items.map((i) => [
      AREA_LABELS[i.area], i.category, i.code, i.text, i.weight, answerLabel(i), i.comment || '', (files.get(i.id) || []).join(', '),
    ]),
  ];
  return BOM + csvRows(rows);
}

function objectCsv(report) {
  const { object, audits, summary } = report;
  const { score } = summary;
  const rows = [
    ['Raport zbiorczy dostępności'],
    ['Obiekt', object.name],
    ['Zatwierdzone audyty', audits.length],
    ['Wynik ogólny', pct(score.total.percent)],
    [AREA_LABELS.OZN, pct(score.areas.OZN.percent)],
    [AREA_LABELS.KSZTALCENIE, pct(score.areas.KSZTALCENIE.percent)],
    [],
    ['Audyt', 'Obiekt', 'Scenariusz', 'Audytor', 'Zatwierdzono', 'Wynik ogólny', AREA_LABELS.OZN, AREA_LABELS.KSZTALCENIE],
    ...audits.map((a) => [
      a.id, a.object_name, a.scenario_title, a.auditor_name, a.approved_at,
      pct(a.score.total.percent), pct(a.score.areas.OZN.percent), pct(a.score.areas.KSZTALCENIE.percent),
    ]),
  ];
  return BOM + csvRows(rows);
}

function officeReportCsv(report) {
  const rows = [
    ['Raport: dostępność kształcenia – oceny kandydatów (audytorów)'],
    ['Zatwierdzone oceny', report.totalReviews],
    [],
    ['Uczelnia', 'Kierunek', 'Liczba ocen', 'Wynik ogólny'],
  ];
  for (const u of report.universities) {
    rows.push([u.name, '(wszystkie kierunki)', u.count, pct(u.score.percent)]);
    for (const p of u.programmes) rows.push([u.name, p.name, p.count, pct(p.score.percent)]);
  }
  rows.push([], ['Uczelnia', 'Kategoria', 'Wynik']);
  for (const u of report.universities) for (const c of u.categories) rows.push([u.name, c.category, pct(c.percent)]);
  return BOM + csvRows(rows);
}

/* ---------- PDF ---------- */

const COLORS = { text: '#1D1D1A', muted: '#555555', primary: '#1457D1', track: '#E4E7EC' };

function newDoc(title) {
  const doc = new PDFDocument({
    size: 'A4', margin: 50, bufferPages: true, lang: 'pl-PL', displayTitle: true,
    info: { Title: title, Producer: 'Tajemniczy Klient' },
  });
  doc.registerFont('regular', FONT);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('regular').fillColor(COLORS.text);
  return doc;
}

function ensureSpace(doc, height) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function heading(doc, text, size = 14) {
  ensureSpace(doc, 40);
  doc.moveDown(0.8).font('bold').fontSize(size).fillColor(COLORS.text).text(text).font('regular').fontSize(10).moveDown(0.3);
}

function scoreBar(doc, label, percent) {
  ensureSpace(doc, 30);
  const x = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('bold').fontSize(10).text(`${label}: ${pct(percent)}`, x, doc.y);
  const y = doc.y + 3;
  doc.rect(x, y, width, 8).fill(COLORS.track);
  if (percent) doc.rect(x, y, (width * percent) / 100, 8).fill(COLORS.primary);
  doc.fillColor(COLORS.text).font('regular');
  doc.y = y + 16;
  doc.x = x;
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const { margins, width, height } = doc.page;
    const oldBottom = margins.bottom;
    margins.bottom = 0; // zapobiega automatycznemu tworzeniu nowej strony przy pisaniu w stopce
    doc.font('regular').fontSize(8).fillColor(COLORS.muted)
      .text(`Strona ${i + 1} z ${range.count}`, margins.left, height - 35, { width: width - margins.left - margins.right, align: 'right' });
    margins.bottom = oldBottom;
  }
}

function summaryBlock(doc, summary) {
  heading(doc, 'Podsumowanie');
  doc.fontSize(10);
  for (const line of summary.lines) doc.text(line, { paragraphGap: 4 });
  scoreBar(doc, 'Wynik ogólny', summary.score.total.percent);
  for (const area of ['OZN', 'KSZTALCENIE']) {
    if (summary.score.areas[area].items > 0) scoreBar(doc, AREA_LABELS[area], summary.score.areas[area].percent);
  }
}

/** Zwraca strumień PDF; wywołujący podłącza go do odpowiedzi HTTP (doc.pipe(res)) i kończy doc.end() sam eksporter. */
function auditPdf(report) {
  const { audit, items, summary, attachments } = report;
  const doc = newDoc(`Raport z audytu – ${audit.object_name}`);
  const files = new Map();
  for (const a of attachments) files.set(a.audit_item_id, [...(files.get(a.audit_item_id) || []), a.original_name]);

  doc.font('bold').fontSize(18).text('Raport z audytu dostępności');
  if (report.preliminary) doc.fontSize(10).fillColor('#B00020').text('RAPORT WSTĘPNY – audyt nie został zatwierdzony').fillColor(COLORS.text);
  doc.font('regular').fontSize(10).moveDown(0.5);
  doc.text(`Obiekt: ${audit.object_name}${audit.object_address ? `, ${audit.object_address}` : ''}`);
  doc.text(`Scenariusz: ${audit.scenario_title}`);
  doc.text(`Audytor: ${audit.auditor_name}`);
  doc.text(`Status: ${STATUS_LABELS[audit.status]}`);
  if (audit.approved_at) doc.text(`Zatwierdzono: ${audit.approved_at} UTC${audit.reviewer_name ? ` (${audit.reviewer_name})` : ''}`);

  summaryBlock(doc, summary);

  if (summary.gaps.length) {
    heading(doc, 'Najważniejsze braki');
    for (const g of summary.gaps) doc.text(`• [waga ${g.weight}] ${g.text}`, { paragraphGap: 2 });
  }

  for (const area of ['OZN', 'KSZTALCENIE']) {
    const areaItems = items.filter((i) => i.area === area);
    if (!areaItems.length) continue;
    heading(doc, AREA_LABELS[area]);
    let category = null;
    for (const i of areaItems) {
      if (i.category !== category) {
        category = i.category;
        ensureSpace(doc, 40);
        doc.moveDown(0.4).font('bold').fontSize(11).text(category).font('regular').fontSize(10);
      }
      ensureSpace(doc, 50);
      doc.text(`${i.code}  ${i.text}`, { continued: false });
      doc.fillColor(COLORS.muted).text(`Waga ${i.weight} · Odpowiedź: ${answerLabel(i)}`);
      if (i.comment) doc.text(`Komentarz: ${i.comment}`);
      if (files.get(i.id)) doc.text(`Załączniki: ${files.get(i.id).join(', ')}`);
      doc.fillColor(COLORS.text).moveDown(0.4);
    }
  }

  if (audit.general_notes) { heading(doc, 'Uwagi ogólne audytora'); doc.text(audit.general_notes); }
  if (audit.review_comment) { heading(doc, 'Komentarz koordynatora'); doc.text(audit.review_comment); }

  addPageNumbers(doc);
  doc.end();
  return doc;
}

function objectPdf(report) {
  const { object, audits, summary, pendingAudits } = report;
  const doc = newDoc(`Raport zbiorczy – ${object.name}`);

  doc.font('bold').fontSize(18).text('Raport zbiorczy dostępności');
  doc.font('regular').fontSize(12).text(object.name);
  doc.fontSize(10).text(`Uwzględniono zatwierdzone audyty: ${audits.length}${pendingAudits ? ` (w toku lub oczekujących: ${pendingAudits})` : ''}`);

  summaryBlock(doc, summary);

  heading(doc, 'Audyty składowe');
  if (!audits.length) doc.text('Brak zatwierdzonych audytów.');
  for (const a of audits) {
    ensureSpace(doc, 45);
    doc.font('bold').text(`#${a.id} ${a.object_name} – ${a.scenario_title}`).font('regular');
    doc.fillColor(COLORS.muted).text(
      `Audytor: ${a.auditor_name} · ogółem ${pct(a.score.total.percent)} · OZN ${pct(a.score.areas.OZN.percent)} · kształcenie ${pct(a.score.areas.KSZTALCENIE.percent)}`,
    ).fillColor(COLORS.text).moveDown(0.4);
  }

  addPageNumbers(doc);
  doc.end();
  return doc;
}

module.exports = { auditCsv, objectCsv, officeReportCsv, auditPdf, objectPdf, csvCell, answerLabel, pct };
