const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { openDatabase } = require('./db');
const { createSzoClient } = require('./services/szoAuth');
const { createDeclarationsService } = require('./services/declarations');
const { createSettingsService } = require('./services/settings');
const { createSzoDirectory } = require('./services/szoDirectory');
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
const { createDeclarationController } = require('./controllers/declarationController');
const { createSettingsController } = require('./controllers/settingsController');
const { createExternalAuthController } = require('./controllers/externalAuthController');
const { createWorkItems } = require('./services/workItems');
const { createExternalAuth } = require('./services/externalAuth');
const { createSmsSender } = require('./services/smsSender');
const { createStatsController } = require('./controllers/statsController');
const { buildRouter } = require('./routes');
const { ROLE_LABELS, AREA_LABELS, OBJECT_TYPES } = require('./domain/constants');
const { STATUS_LABELS } = require('./domain/workflow');
const { pct, answerLabel } = require('./services/exporters');

const dateFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
const dayFmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'UTC' });

function createApp(config, { fetchImpl, db = openDatabase(config.databasePath), szoClient, mailer: mailerOverride } = {}) {
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
  const settings = createSettingsService(db, config);
  const szoDirectory = createSzoDirectory(config, { fetchImpl, getApiKey: () => settings.szoApiKey() });
  const mailer = mailerOverride || createMailer(config.mail, { szo: { ...config.szo, getApiKey: () => settings.szoApiKey() }, fetchImpl });
  const sessions = createSessionService(config);
  const stats = createStatsService(db, { objects, reports, office, audits });
  const declarations = createDeclarationsService(db);
  const history = createHistoryService(db);
  const notifier = createNotifier(db, { config, mailer, users, objects });
  const workItems = createWorkItems({ audits, office });
  const sms = createSmsSender(config, { fetchImpl, getApiKey: () => settings.szoApiKey() });
  const externalAuth = createExternalAuth(db, { config, users, sms });

  /* --- adresy plików statycznych z odciskiem treści (?v=…): po wdrożeniu przeglądarka i CDN (Cloudflare) pobierają nową wersję --- */
  const assetHashes = new Map();
  const asset = (file) => {
    let hash = assetHashes.get(file);
    if (!hash) {
      try { hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'public', file))).digest('hex').slice(0, 10); } catch { hash = '0'; }
      if (config.isProd) assetHashes.set(file, hash);   // w rozwoju liczymy na bieżąco, żeby zmiany były od razu widoczne
    }
    return `/${file}?v=${hash}`;
  };
  const appVersion = require('../package.json').version.split('.').slice(0, 2).join('.');

  /* --- globalne dane widoków --- */
  Object.assign(app.locals, {
    roleLabels: ROLE_LABELS, areaLabels: AREA_LABELS, objectTypeLabels: OBJECT_TYPES, statusLabels: STATUS_LABELS,
    fmtPct: pct, answerLabel,
    fmtDateTime: (s) => (s ? dateFmt.format(new Date(`${String(s).replace(' ', 'T')}Z`)) : '—'),
    fmtDate: (s) => (s ? dayFmt.format(new Date(`${s}T00:00:00Z`)) : '—'),
    appMode: config.szo.mode,
    asset, appVersion,
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
    config, declarations,
    auth: createAuthController({ config, szo, szoPkce, users, sessions, notifier, declarations, externalEnabled: () => externalAuth.enabled }),
    extAuth: createExternalAuthController({ externalAuth, sessions, config, enabled: () => externalAuth.enabled }),
    admin: createAdminController({ objects, catalog, users, szoDirectory, notifier, externalAuth, mailer, importDomains: config.szo.importDomains, declarations, declarationRequired: config.declarationRequired }),
    settingsCtl: createSettingsController({ settings, szoDirectory, config }),
    declarationCtl: createDeclarationController({ declarations }),
    auditsCtl: createAuditsController({ workItems, audits, objects, users, catalog, attachments, reports, history, notifier }),
    reportsCtl: createReportsController({ reports, objects, audits, workItems }),
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

  return { app, db, services: { users, objects, catalog, audits, attachments, reports, office, snapshots, sessions, history, notifier, stats, settings, declarations, externalAuth, sms } };
}

module.exports = { createApp };
