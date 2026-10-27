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

/** Rodzaje załączników: audyty obiektów (kryterium) i oceny „Dostępność kształcenia” (pytanie). */
const KINDS = {
  audit: { table: 'attachments', fk: 'audit_item_id', items: 'audit_items', owner: 'audit_id' },
  review: { table: 'office_attachments', fk: 'review_item_id', items: 'office_review_items', owner: 'review_id' },
};

function createAttachmentsService(db, cfg) {
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const kind = (k) => {
    const c = KINDS[k];
    if (!c) throw new Error(`Nieznany rodzaj załączników: ${k}`);
    return c;
  };

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
    /** Middleware multer dla formularzy: pola plików nazywają się `files_<id pozycji>`. */
    middleware: upload.any(),

    /**
     * Zapisuje metadane wgranych plików po sprawdzeniu sygnatury (magic bytes); niepoprawne usuwa z dysku.
     * Zwraca nazwy przyjętych i odrzuconych plików.
     */
    async register(files, { ownerId, userId, kind: k = 'audit' }) {
      const c = kind(k);
      const rejected = [];
      const accepted = [];
      const valid = db.prepare(`SELECT id FROM ${c.items} WHERE ${c.owner} = ?`).all(ownerId).map((r) => String(r.id));
      const insert = db.prepare(`INSERT INTO ${c.table} (${c.fk}, original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`);

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
        accepted.push(originalName);
      }
      return { rejected, accepted };
    },

    discard: (files) => Promise.all((files || []).map((f) => safeUnlink(f.filename))),

    /** Załączniki właściciela (audytu lub oceny) pogrupowane wg pozycji formularza. */
    list(k, ownerId) {
      const c = kind(k);
      const rows = db.prepare(`SELECT att.*, att.${c.fk} AS item_id FROM ${c.table} att JOIN ${c.items} i ON i.id = att.${c.fk}
        WHERE i.${c.owner} = ? ORDER BY att.id`).all(ownerId);
      const byItem = new Map();
      for (const r of rows) byItem.set(r.item_id, [...(byItem.get(r.item_id) || []), r]);
      return byItem;
    },

    get(k, id, ownerId) {
      const c = kind(k);
      return db.prepare(`SELECT att.* FROM ${c.table} att JOIN ${c.items} i ON i.id = att.${c.fk}
        WHERE att.id = ? AND i.${c.owner} = ?`).get(id, ownerId);
    },

    filePath: (att) => path.join(cfg.uploadDir, path.basename(att.stored_name)),

    async remove(k, att) {
      db.prepare(`DELETE FROM ${kind(k).table} WHERE id = ?`).run(att.id);
      await safeUnlink(att.stored_name);
    },

    /** Usuwa z dysku pliki załączników należących do właściciela (przed skasowaniem audytu lub oceny). */
    async purge(k, ownerId) {
      const c = kind(k);
      const rows = db.prepare(`SELECT att.stored_name FROM ${c.table} att JOIN ${c.items} i ON i.id = att.${c.fk} WHERE i.${c.owner} = ?`).all(ownerId);
      await Promise.all(rows.map((r) => safeUnlink(r.stored_name)));
    },

    // Zgodność wsteczna dla audytów
    listForAudit: (auditId) => svc.list('audit', auditId),
    getForAudit: (id, auditId) => svc.get('audit', id, auditId),
  };
  return svc;
}

module.exports = { createAttachmentsService, ALLOWED };
