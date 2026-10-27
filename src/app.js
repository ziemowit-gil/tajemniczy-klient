const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { openDatabase } = require('./db');
const { createSzoClient } = require('./services/szoAuth');
const { createSzoPkceClient } = require('./services/szoPkce');
const { createSessionService } = require('./services/session');
const { createUsersService } = require('./services/users');
const { createObjectsService } = require('./services/objects');
const { createCatalogService } = require('./services/catalog');
const { createAuditsService } = require('./services/audits');
const { createAttachmentsService } = require('./services/attachments');
const { createReportsService } = require('./services/reports');
const { createScenarioSnapshots } = require('./services/scenarioSnapshots');
const { createStatsService } = require('./services/stats');
const { createHistoryService } = require('./services/history');
const { createMailer } = require('./services/mailer');
const { createNotifier } = require('./services/notifications');
const { createOfficeReviewsService } = require('./services/officeReviews');

const { attachUser, sameOriginOnly } = require('./middleware/auth');
const { flashMiddleware } = require('./controllers/helpers');
const { createAuthController } = require('./controllers/authController');
const { createAdminController } = require('./controllers/adminController');
const { createAuditsController } = require('./controllers/auditsController');
const { createReportsController } = require('./controllers/reportsController');
const { createOfficeController } = require('./controllers/officeController');
const { createStatsController } = require('./controllers/statsController');
const { buildRouter } = require('./routes');
const { ROLE_LABELS, AREA_LABELS, OBJECT_TYPES } = require('./domain/constants');
const { STATUS_LABELS } = require('./domain/workflow');
const { pct, answerLabel } = require('./services/exporters');

const dateFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
const dayFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'UTC' });

function createApp(config, { db = openDatabase(config.databasePath), szoClient, mailer = createMailer(config.mail), fetchImpl } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  /* --- serwisy --- */
  const users = createUsersService(db, { defaultRole: config.szo.defaultRole });
  const objects = createObjectsService(db);
  const catalog = createCatalogService(db);
  const snapshots = createScenarioSnapshots(db);
  const audits = createAuditsService(db, { objects, users, snapshots });
  const attachments = createAttachmentsService(db, config);
  const reports = createReportsService(db, { objects, audits, snapshots });
  const office = createOfficeReviewsService(db, { objects, users, snapshots });
  const szo = szoClient || createSzoClient(config.szo);
  const szoPkce = createSzoPkceClient(config, { fetchImpl });
  const sessions = createSessionService(config);
  const stats = createStatsService(db, { objects, reports, office, audits });
  const history = createHistoryService(db);
  const notifier = createNotifier(db, { config, mailer, users, objects });

  /* --- globalne dane widoków --- */
  Object.assign(app.locals, {
    roleLabels: ROLE_LABELS, areaLabels: AREA_LABELS, objectTypeLabels: OBJECT_TYPES, statusLabels: STATUS_LABELS,
    fmtPct: pct, answerLabel,
    fmtDateTime: (s) => (s ? dateFmt.format(new Date(`${String(s).replace(' ', 'T')}Z`)) : '—'),
    fmtDate: (s) => (s ? dayFmt.format(new Date(`${s}T00:00:00Z`)) : '—'),
    appMode: config.szo.mode,
  });

  /* --- middleware --- */
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'style-src': ["'self'"], 'script-src': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"], 'upgrade-insecure-requests': config.isProd ? [] : null } },
    referrerPolicy: { policy: 'same-origin' },
    strictTransportSecurity: config.isProd,
  }));
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '1h' : 0 }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.locals.currentPath = req.path; res.locals.currentUser = null; next(); });
  app.use(express.urlencoded({ extended: true, parameterLimit: 5000, limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(flashMiddleware);
  app.use(attachUser({ szo, users, sessions }));
  app.use(sameOriginOnly(config));

  /* --- routing --- */
  app.use(buildRouter({
    config,
    auth: createAuthController({ config, szo, szoPkce, users, sessions, notifier }),
    admin: createAdminController({ objects, catalog, users }),
    auditsCtl: createAuditsController({ audits, objects, users, catalog, attachments, reports, history, notifier }),
    reportsCtl: createReportsController({ reports, objects, audits }),
    statsCtl: createStatsController({ stats }),
    officeCtl: createOfficeController({ office, objects, catalog, users, attachments, history, notifier }),
    attachments,
  }));

  app.use((req, res, next) => {
    const err = new Error('Nie znaleziono strony.');
    err.status = 404;
    next(err);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 && config.isProd ? 'Wystąpił nieoczekiwany błąd serwera.' : err.message;
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') return res.status(status).json({ error: message });
    return res.status(status).render('error', { title: 'Błąd', status, message });
  });

  return { app, db, services: { users, objects, catalog, audits, attachments, reports, office, snapshots, sessions, history, notifier, stats } };
}

module.exports = { createApp };
