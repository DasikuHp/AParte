const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Correspondencia entre los nombres de la API (camelCase, los que usa el front)
// y las columnas de SQLite (snake_case). Todo pasa por aquí para que no se pierdan campos.
const FIELDS = {
  empresa: 'empresa',
  direccion: 'direccion',
  contacto: 'contacto',
  telefono: 'telefono',
  emailCliente: 'email_cliente',
  emailPara: 'email_para',
  emailCC: 'email_cc',
  fecha: 'fecha', // yyyy-mm-dd
  horaEntrada: 'hora_entrada',
  horaSalida: 'hora_salida',
  totalHoras: 'total_horas',
  desplazamiento: 'desplazamiento',
  descripcion: 'descripcion',
  pendiente: 'pendiente',
  mats: 'mats', // JSON
  fotos: 'fotos', // JSON (array de URLs)
  firmaCliente: 'firma_cliente', // data URL PNG del canvas
};
const JSON_FIELDS = new Set(['mats', 'fotos']);
const LIST_COLUMNS = `id, tech, empresa, fecha, total_horas, status, created_at, updated_at, sent_at`;

const MAX_TEXT = 5000;
const MAX_FIRMA = 500 * 1024; // ~500 KB de data URL
const MAX_PDF = 10 * 1024 * 1024; // ~10 MB de base64
const MAX_DESTINATARIOS = 10;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const FOTO_TIPOS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
// En la demo pública se limita lo que un visitante puede guardar en el servidor.
const DEMO_MAX_PARTES = 200;
const DEMO_MAX_FOTOS = 100;

function fromRow(row) {
  if (!row) return row;
  const out = {
    id: row.id,
    tech: row.tech,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
  for (const [api, col] of Object.entries(FIELDS)) {
    if (!(col in row)) continue;
    out[api] = JSON_FIELDS.has(api) ? (row[col] ? JSON.parse(row[col]) : []) : row[col];
  }
  if ('pdf_base64' in row) out.tienePdf = Boolean(row.pdf_base64);
  return out;
}

// Valida y convierte el cuerpo de la petición en columnas. Lanza Error con status 400.
function toColumns(body) {
  const cols = {};
  for (const [api, col] of Object.entries(FIELDS)) {
    if (body[api] === undefined) continue;
    let val = body[api];
    if (JSON_FIELDS.has(api)) {
      if (!Array.isArray(val)) throw badRequest(`${api} debe ser una lista`);
      if (api === 'fotos' && !val.every((u) => typeof u === 'string' && u.startsWith('/uploads/'))) {
        throw badRequest('fotos contiene URLs no válidas');
      }
      val = JSON.stringify(val);
      if (val.length > 50000) throw badRequest(`${api} es demasiado grande`);
    } else if (val !== null) {
      val = String(val);
      if (api === 'firmaCliente') {
        if (!val.startsWith('data:image/png;base64,') || val.length > MAX_FIRMA) {
          throw badRequest('Firma no válida');
        }
      } else if (val.length > MAX_TEXT) {
        throw badRequest(`${api} es demasiado largo`);
      }
    }
    cols[col] = val;
  }
  return cols;
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

function parseEmails(value) {
  const list = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((e) => String(e).trim())
    .filter(Boolean);
  if (list.length > MAX_DESTINATARIOS) throw badRequest('Demasiados destinatarios');
  for (const e of list) if (!EMAIL_RE.test(e)) throw badRequest(`Email no válido: ${e}`);
  return list;
}

function partesRouter({ db, mailer, config, tecnicos }) {
  const router = express.Router();
  fs.mkdirSync(config.uploadsDir, { recursive: true });

  const getParte = db.prepare('SELECT * FROM partes WHERE id = ?');

  // Carga el parte y comprueba que pertenece al técnico de la sesión.
  function loadOwn(req, res) {
    const row = getParte.get(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Parte no encontrado' });
      return null;
    }
    if (row.tech !== req.session.tech) {
      res.status(403).json({ error: 'Este parte es de otro técnico' });
      return null;
    }
    return row;
  }

  // GET /api/partes?tech=&status=&q=  (todos los técnicos ven el historial común)
  router.get('/partes', (req, res) => {
    const { tech, status, q } = req.query;
    let sql = `SELECT ${LIST_COLUMNS} FROM partes WHERE 1=1`;
    const params = [];
    if (typeof tech === 'string' && tech) {
      sql += ' AND tech = ?';
      params.push(tech);
    }
    if (status === 'draft' || status === 'sent') {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (typeof q === 'string' && q.trim()) {
      sql += ' AND (empresa LIKE ? OR descripcion LIKE ? OR fecha LIKE ?)';
      const term = `%${q.trim()}%`;
      params.push(term, term, term);
    }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    res.json(db.prepare(sql).all(...params).map(fromRow));
  });

  router.get('/partes/:id', (req, res) => {
    const row = getParte.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Parte no encontrado' });
    const parte = fromRow(row);
    parte.editable = row.tech === req.session.tech;
    res.json(parte);
  });

  // PDF guardado del último envío.
  router.get('/partes/:id/pdf', (req, res) => {
    const row = getParte.get(req.params.id);
    if (!row || !row.pdf_base64) return res.status(404).json({ error: 'Este parte no tiene PDF' });
    res.type('application/pdf');
    res.set('Content-Disposition', `inline; filename="parte-${row.id.slice(0, 8)}.pdf"`);
    res.send(Buffer.from(row.pdf_base64, 'base64'));
  });

  router.post('/partes', (req, res) => {
    if (config.demo && db.prepare('SELECT COUNT(*) AS n FROM partes').get().n >= DEMO_MAX_PARTES) {
      return res.status(429).json({ error: 'La demo ha llegado al máximo de partes' });
    }
    const cols = toColumns(req.body || {});
    cols.id = crypto.randomUUID();
    cols.tech = req.session.tech; // el técnico sale de la sesión, nunca del cuerpo
    cols.status = 'draft';
    const names = Object.keys(cols);
    db.prepare(`INSERT INTO partes (${names.join(', ')}) VALUES (${names.map((n) => '@' + n).join(', ')})`)
      .run(cols);
    res.status(201).json(fromRow(getParte.get(cols.id)));
  });

  // Actualiza un parte propio. No cambia ni el técnico ni el estado (un parte
  // enviado se puede corregir y reenviar; sigue constando como enviado).
  router.put('/partes/:id', (req, res) => {
    if (!loadOwn(req, res)) return;
    const cols = toColumns(req.body || {});
    const names = Object.keys(cols);
    if (names.length) {
      db.prepare(`UPDATE partes SET ${names.map((n) => `${n} = @${n}`).join(', ')},
        updated_at = datetime('now') WHERE id = @id`).run({ ...cols, id: req.params.id });
    }
    res.json(fromRow(getParte.get(req.params.id)));
  });

  router.delete('/partes/:id', (req, res) => {
    if (!loadOwn(req, res)) return;
    db.prepare('DELETE FROM partes WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  });

  // POST /api/partes/:id/send  { para, cc, pdfBase64, filename }
  // Solo se marca como enviado si el servidor de correo acepta el mensaje.
  router.post('/partes/:id/send', async (req, res, next) => {
    try {
      const row = loadOwn(req, res);
      if (!row) return;
      const { pdfBase64, filename } = req.body || {};
      const para = parseEmails(req.body?.para);
      const cc = parseEmails(req.body?.cc);
      if (para.length === 0) throw badRequest('Falta el destinatario');
      if (typeof pdfBase64 !== 'string' || !pdfBase64 || pdfBase64.length > MAX_PDF) {
        throw badRequest('PDF no válido');
      }
      const pdf = pdfBase64.includes(',') ? pdfBase64.split(',')[1] : pdfBase64;
      const tecnico = tecnicos.get(row.tech);
      const fecha = row.fecha ? row.fecha.split('-').reverse().join('/') : '';

      try {
        await mailer.send({
          to: para,
          cc,
          replyTo: tecnico?.email,
          subject: `Parte de servicio - ${row.empresa || 'Cliente'}${fecha ? ' - ' + fecha : ''}`,
          text: `Adjunto el parte de servicio${tecnico ? ' de ' + tecnico.nombre : ''}.`,
          attachments: [{
            filename: String(filename || 'parte-servicio.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 100),
            content: pdf,
            encoding: 'base64',
            contentType: 'application/pdf',
          }],
        });
      } catch (mailErr) {
        console.error('[SMTP]', mailErr.message);
        return res.status(502).json({ emailSent: false, error: 'No se pudo enviar el correo. El parte sigue como borrador.' });
      }

      db.prepare(`UPDATE partes SET status = 'sent', pdf_base64 = ?, sent_at = datetime('now'),
        updated_at = datetime('now') WHERE id = ?`).run(pdf, row.id);
      res.json({ emailSent: true, simulated: mailer.simulated, parte: fromRow(getParte.get(row.id)) });
    } catch (err) {
      next(err);
    }
  });

  // Fotos: solo imágenes JPEG/PNG/WebP, máx. 8 MB, con nombre aleatorio.
  // La extensión sale del tipo MIME, nunca del nombre que manda el cliente.
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadsDir,
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + FOTO_TIPOS[file.mimetype]),
    }),
    limits: { fileSize: (config.demo ? 2 : 8) * 1024 * 1024, files: 1, fields: 0 },
    fileFilter: (req, file, cb) => cb(FOTO_TIPOS[file.mimetype] ? null : badRequest('Solo se admiten fotos JPEG, PNG o WebP'), true),
  });

  router.post('/upload', (req, res, next) => {
    if (config.demo && fs.readdirSync(config.uploadsDir).length >= DEMO_MAX_FOTOS) {
      return res.status(429).json({ error: 'La demo ha llegado al máximo de fotos' });
    }
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) err.status = 400;
        return next(err);
      }
      if (!req.file) return res.status(400).json({ error: 'No se ha enviado ninguna foto' });
      res.status(201).json({ url: '/uploads/' + path.basename(req.file.filename) });
    });
  });

  return router;
}

module.exports = { partesRouter };
