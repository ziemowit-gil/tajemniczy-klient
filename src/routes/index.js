const express = require('express');
const { requireAuth, requireDeclaration, requireRole } = require('../middleware/auth');
const { ROLES } = require('../domain/constants');

const { ADMIN, AUDITOR, COORDINATOR } = ROLES;

function buildRouter({ auth, extAuth, admin, auditsCtl, reportsCtl, officeCtl, statsCtl, settingsCtl, declarationCtl, declarations, attachments, config }) {
  const r = express.Router();

  /* --- publiczne --- */
  r.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  r.get('/login', auth.showLogin);
  /* logowanie użytkowników zewnętrznych: e-mail + hasło, potem kod SMS */
  r.post('/login/external', extAuth.login);
  r.get('/login/verify', extAuth.showVerify);
  r.post('/login/verify', extAuth.verify);
  r.post('/login/verify/resend', extAuth.resend);
  r.get('/ext/set-password', extAuth.showSetPassword);
  r.post('/ext/set-password', extAuth.setPassword);
  r.get('/auth/callback', auth.szoCallback);
  r.get('/auth/szo/start', auth.szoStart);
  r.get('/auth/szo/callback', auth.szoReturn);
  r.post('/auth/callback', auth.szoCallback);
  if (config.szo.mode === 'dev' && !config.isProd) r.post('/auth/dev', auth.devLogin);

  /* --- wszystko poniżej wymaga zalogowania --- */
  r.use(requireAuth);
  r.use(requireDeclaration({ declarations, enabled: config.declarationRequired }));
  r.get('/declaration', declarationCtl.show);
  r.post('/declaration', declarationCtl.accept);
  r.post('/logout', auth.logout);
  r.post('/role', auth.switchRole);
  r.get('/', reportsCtl.dashboard);
  r.get('/account', auth.showAccount);
  r.post('/account', auth.updateAccount);

  /* --- obiekty --- */
  r.get('/objects', requireRole(ADMIN, COORDINATOR), admin.objectsIndex);
  r.get('/objects/new', requireRole(ADMIN), admin.objectNew);
  r.post('/objects', requireRole(ADMIN), admin.objectCreate);
  r.get('/objects/:id/edit', requireRole(ADMIN), admin.objectEdit);
  r.post('/objects/:id', requireRole(ADMIN), admin.objectUpdate);
  r.post('/objects/:id/delete', requireRole(ADMIN), admin.objectDelete);

  /* --- kryteria i scenariusze --- */
  r.get('/criteria', requireRole(ADMIN), admin.criteriaIndex);
  r.get('/criteria/new', requireRole(ADMIN), admin.criterionNew);
  r.post('/criteria', requireRole(ADMIN), admin.criterionCreate);
  r.get('/criteria/:id/edit', requireRole(ADMIN), admin.criterionEdit);
  r.post('/criteria/:id', requireRole(ADMIN), admin.criterionUpdate);
  r.post('/criteria/:id/delete', requireRole(ADMIN), admin.criterionDelete);

  r.get('/scenarios', requireRole(ADMIN), admin.scenariosIndex);
  r.get('/scenarios/new', requireRole(ADMIN), admin.scenarioNew);
  r.post('/scenarios', requireRole(ADMIN), admin.scenarioCreate);
  r.post('/scenarios/import-pack', requireRole(ADMIN), admin.scenariosImportPack);
  r.get('/scenarios/:id', requireRole(ADMIN), admin.scenarioShow);
  r.get('/scenarios/:id/edit', requireRole(ADMIN), admin.scenarioEdit);
  r.post('/scenarios/:id/duplicate', requireRole(ADMIN), admin.scenarioDuplicate);
  r.post('/scenarios/:id', requireRole(ADMIN), admin.scenarioUpdate);
  r.post('/scenarios/:id/delete', requireRole(ADMIN), admin.scenarioDelete);

  /* --- użytkownicy --- */
  r.get('/users', requireRole(ADMIN), admin.usersIndex);
  r.get('/users/import', requireRole(ADMIN), admin.usersImportForm);
  r.post('/users/import', requireRole(ADMIN), admin.usersImport);
  r.post('/users/import/email', requireRole(ADMIN), admin.usersImportByEmail);
  r.post('/users/external', requireRole(ADMIN), admin.externalCreate);
  r.post('/users/:id/external/link', requireRole(ADMIN), admin.externalResendLink);
  r.post('/users/:id/external/phone', requireRole(ADMIN), admin.externalPhone);
  r.post('/users/:id', requireRole(ADMIN), admin.userUpdate);

  /* --- ustawienia: integracja z SZO (klucz API) --- */
  r.get('/settings/szo', requireRole(ADMIN), settingsCtl.show);
  r.post('/settings/szo', requireRole(ADMIN), settingsCtl.save);
  r.post('/settings/szo/check', requireRole(ADMIN), settingsCtl.check);
  r.post('/settings/szo/clear', requireRole(ADMIN), settingsCtl.clear);

  /* --- audyty --- */
  r.get('/audits', auditsCtl.index);
  r.get('/audits/new', requireRole(ADMIN, COORDINATOR), auditsCtl.newForm);
  r.post('/audits', requireRole(ADMIN, COORDINATOR), auditsCtl.create);
  r.get('/audits/:id', auditsCtl.load, auditsCtl.show);

  // Kolejność: uprawnienia → sprawdzenie edycji → dopiero potem zapis plików na dysk.
  const uploadWith = (base) => (req, res, next) => attachments.middleware(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Plik jest za duży (maks. ${Math.round(config.maxUploadBytes / 1048576)} MB).`
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Za dużo plików w jednym zapisie.' : err.message;
    res.flash('error', `Nie zapisano formularza. ${message}`);
    return res.redirect(303, `${base}/${(req.audit || req.review).id}`);
  });
  const handleUpload = uploadWith('/audits');
  const handleOfficeUpload = uploadWith('/office');
  r.post('/audits/:id', requireRole(AUDITOR), auditsCtl.load, auditsCtl.ensureEditable, handleUpload, auditsCtl.save);

  r.post('/audits/:id/accept', requireRole(AUDITOR), auditsCtl.load, auditsCtl.accept);
  r.post('/audits/:id/approve', requireRole(COORDINATOR, ADMIN), auditsCtl.load, auditsCtl.approve);
  r.post('/audits/:id/return', requireRole(COORDINATOR, ADMIN), auditsCtl.load, auditsCtl.returnForCorrection);
  r.post('/audits/:id/assign', requireRole(ADMIN, COORDINATOR), auditsCtl.load, auditsCtl.assign);
  r.post('/audits/:id/delete', requireRole(ADMIN, COORDINATOR), auditsCtl.load, auditsCtl.remove);
  r.get('/audits/:id/attachments/:attId', auditsCtl.load, auditsCtl.download);
  r.post('/audits/:id/attachments/:attId/delete', requireRole(AUDITOR), auditsCtl.load, auditsCtl.ensureEditable, auditsCtl.deleteAttachment);
  r.get('/audits/:id/report.csv', auditsCtl.load, reportsCtl.auditCsv);
  r.get('/audits/:id/report.pdf', auditsCtl.load, reportsCtl.auditPdf);

  /* --- raporty zbiorcze --- */
  r.get('/reports', requireRole(ADMIN, COORDINATOR), reportsCtl.index);
  r.get('/reports/objects/:id', requireRole(ADMIN, COORDINATOR), reportsCtl.object);
  r.get('/reports/objects/:id/report.csv', requireRole(ADMIN, COORDINATOR), reportsCtl.objectCsv);
  r.get('/reports/objects/:id/report.pdf', requireRole(ADMIN, COORDINATOR), reportsCtl.objectPdf);

  /* --- statystyki: ranking i trendy --- */
  r.get('/stats', requireRole(ADMIN, COORDINATOR), statsCtl.index);
  r.get('/stats/ranking.csv', requireRole(ADMIN, COORDINATOR), statsCtl.rankingCsv);
  r.get('/stats/trend.csv', requireRole(ADMIN, COORDINATOR), statsCtl.trendCsv);

  /* --- dostępność kształcenia: ocena przez audytora w roli kandydata --- */
  r.get('/office', officeCtl.index);
  r.get('/office/new', requireRole(AUDITOR, ADMIN), officeCtl.newForm);
  r.post('/office', requireRole(AUDITOR, ADMIN), officeCtl.create);
  r.get('/office/report', requireRole(ADMIN, COORDINATOR), officeCtl.report);
  r.get('/office/report.csv', requireRole(ADMIN, COORDINATOR), officeCtl.reportCsv);
  r.get('/office/questions', requireRole(ADMIN), officeCtl.questionsIndex);
  r.get('/office/questions/new', requireRole(ADMIN), officeCtl.questionNew);
  r.post('/office/questions', requireRole(ADMIN), officeCtl.questionCreate);
  r.get('/office/questions/:id/edit', requireRole(ADMIN), officeCtl.questionEdit);
  r.post('/office/questions/:id', requireRole(ADMIN), officeCtl.questionUpdate);
  r.post('/office/questions/:id/delete', requireRole(ADMIN), officeCtl.questionDelete);
  r.get('/office/:id', officeCtl.load, officeCtl.show);
  r.post('/office/:id', requireRole(AUDITOR), officeCtl.load, officeCtl.ensureEditable, handleOfficeUpload, officeCtl.save);
  r.get('/office/:id/attachments/:attId', officeCtl.load, officeCtl.download);
  r.post('/office/:id/attachments/:attId/delete', requireRole(AUDITOR), officeCtl.load, officeCtl.ensureEditable, officeCtl.deleteAttachment);
  r.post('/office/:id/scenarios', requireRole(ADMIN), officeCtl.load, officeCtl.assignScenarios);
  r.post('/office/:id/approve', requireRole(COORDINATOR, ADMIN), officeCtl.load, officeCtl.approve);
  r.post('/office/:id/return', requireRole(COORDINATOR, ADMIN), officeCtl.load, officeCtl.returnForCorrection);
  r.post('/office/:id/delete', officeCtl.load, officeCtl.remove);

  return r;
}

module.exports = { buildRouter };
