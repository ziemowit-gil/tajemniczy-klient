const exporters = require('../services/exporters');
const { AREA_LABELS } = require('../domain/constants');
const { ROLES } = require('../domain/constants');
const { STATUS, STATUS_LABELS } = require('../domain/workflow');
const { paramId, httpError } = require('./helpers');

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/gi, 'l')
  .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'raport';

function createReportsController({ reports, objects, audits }) {
  const loadObject = (req) => {
    const id = paramId(req);
    const object = objects.get(id);
    if (!object || !reports.canViewObject(req.user, id)) throw httpError(404, 'Nie znaleziono obiektu.');
    return object;
  };

  const sendCsv = (res, filename, body) => {
    res.attachment(`${filename}.csv`);
    res.type('text/csv; charset=utf-8').send(body);
  };
  const sendPdf = (res, filename, doc) => {
    res.attachment(`${filename}.pdf`);
    res.type('application/pdf');
    doc.pipe(res);
  };

  return {
    index(req, res) {
      res.render('reports/index', { title: 'Raporty', rows: reports.overview(req.user), areaLabels: AREA_LABELS });
    },

    object(req, res) {
      const object = loadObject(req);
      res.render('reports/object', { title: `Raport: ${object.name}`, report: reports.forObject(object.id), areaLabels: AREA_LABELS });
    },
    objectCsv(req, res) {
      const object = loadObject(req);
      sendCsv(res, `raport-${slug(object.name)}`, exporters.objectCsv(reports.forObject(object.id)));
    },
    objectPdf(req, res) {
      const object = loadObject(req);
      sendPdf(res, `raport-${slug(object.name)}`, exporters.objectPdf(reports.forObject(object.id)));
    },

    /** Eksport pojedynczego audytu; audytor może pobrać tylko własny audyt (kontrola w audits.load). */
    auditCsv(req, res) {
      sendCsv(res, `audyt-${req.audit.id}-${slug(req.audit.object_name)}`, exporters.auditCsv(reports.forAudit(req.audit)));
    },
    auditPdf(req, res) {
      sendPdf(res, `audyt-${req.audit.id}-${slug(req.audit.object_name)}`, exporters.auditPdf(reports.forAudit(req.audit)));
    },

    dashboard(req, res) {
      const mine = audits.list(req.user);
      const counts = Object.fromEntries(Object.values(STATUS).map((s) => [s, mine.filter((a) => a.status === s).length]));
      const actionable = {
        [ROLES.AUDITOR]: [STATUS.ASSIGNED, STATUS.IN_PROGRESS],
        [ROLES.COORDINATOR]: [STATUS.SUBMITTED, STATUS.ENTERED],
        [ROLES.ADMIN]: [STATUS.SUBMITTED, STATUS.ENTERED],
      }[req.user.role];
      res.render('dashboard', {
        title: 'Pulpit', counts, statusLabels: STATUS_LABELS,
        todo: mine.filter((a) => actionable.includes(a.status)).slice(0, 10),
        todoHeading: req.user.role === ROLES.AUDITOR ? 'Do wykonania' : 'Wymagają Twojej uwagi (do weryfikacji lub przydziału)',
      });
    },
  };
}

module.exports = { createReportsController };
