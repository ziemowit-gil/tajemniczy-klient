const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const ALLOWED = {
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  'application/pdf': { ext: '.pdf', magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
};

const MAX_FILES_PER_REQUEST = 20;

function createAttachmentsService(db, cfg) {
  fs.mkdirSync(cfg.uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, cfg.uploadDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype]?.ext ?? '.bin'}`),
  });

  const upload = multer({
    storage,
    limits: { fileSize: cfg.maxUploadBytes, files: MAX_FILES_PER_REQUEST },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED[file.mimetype]) {
        const err = new Error('Dozwolone załączniki: JPEG, PNG, WebP lub PDF.');
        err.status = 422;
        return cb(err);
      }
      cb(null, true);
    },
  });

  const safeUnlink = (file) => fs.promises.unlink(path.join(cfg.uploadDir, file)).catch(() => {});

  const svc = {
    /** Middleware multer dla formularza audytu: pola plików nazywają się `files_<id kryterium w audycie>`. */
    middleware: upload.any(),

    /** Zapisuje metadane wgranych plików po sprawdzeniu sygnatury (magic bytes); niepoprawne usuwa z dysku. */
    async register(files, { auditId, userId }) {
      const rejected = [];
      const valid = db.prepare('SELECT id FROM audit_items WHERE audit_id = ?').all(auditId).map((r) => String(r.id));
      const insert = db.prepare(`INSERT INTO attachments (audit_item_id, original_name, stored_name, mime, size, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?)`);

      for (const file of files || []) {
        const m = /^files_(\d+)$/.exec(file.fieldname);
        let ok = Boolean(m && valid.includes(m[1]));
        if (ok) {
          const head = Buffer.alloc(16);
          const fd = await fs.promises.open(file.path, 'r');
          try { await fd.read(head, 0, 16, 0); } finally { await fd.close(); }
          ok = ALLOWED[file.mimetype].magic(head);
        }
        if (!ok) {
          rejected.push(file.originalname);
          await safeUnlink(file.filename);
          continue;
        }
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
        insert.run(Number(m[1]), originalName, file.filename, file.mimetype, file.size, userId);
      }
      return { rejected };
    },

    discard: (files) => Promise.all((files || []).map((f) => safeUnlink(f.filename))),

    listForAudit(auditId) {
      const rows = db.prepare(`SELECT att.* FROM attachments att JOIN audit_items i ON i.id = att.audit_item_id
        WHERE i.audit_id = ? ORDER BY att.id`).all(auditId);
      const byItem = new Map();
      for (const r of rows) byItem.set(r.audit_item_id, [...(byItem.get(r.audit_item_id) || []), r]);
      return byItem;
    },

    getForAudit: (id, auditId) => db.prepare(`SELECT att.* FROM attachments att JOIN audit_items i ON i.id = att.audit_item_id
      WHERE att.id = ? AND i.audit_id = ?`).get(id, auditId),

    filePath: (att) => path.join(cfg.uploadDir, path.basename(att.stored_name)),

    async remove(att) {
      db.prepare('DELETE FROM attachments WHERE id = ?').run(att.id);
      await safeUnlink(att.stored_name);
    },
  };
  return svc;
}

module.exports = { createAttachmentsService, ALLOWED };
