const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Cada migración se aplica una vez; PRAGMA user_version guarda por cuál va la BD.
const MIGRATIONS = [
  // 1: esquema original
  fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8'),

  // 2: los técnicos salen de config/tecnicos.json (sin CHECK fijo), la fecha pasa
  //    a ISO (yyyy-mm-dd), y se guardan la firma del cliente y la fecha de envío.
  `
  CREATE TABLE partes_v2 (
    id             TEXT PRIMARY KEY,
    tech           TEXT NOT NULL,
    empresa        TEXT,
    direccion      TEXT,
    contacto       TEXT,
    telefono       TEXT,
    email_cliente  TEXT,
    email_para     TEXT,
    email_cc       TEXT,
    fecha          TEXT,
    hora_entrada   TEXT,
    hora_salida    TEXT,
    total_horas    TEXT,
    desplazamiento TEXT,
    descripcion    TEXT,
    pendiente      TEXT,
    mats           TEXT,
    fotos          TEXT,
    firma_cliente  TEXT,
    status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent')),
    pdf_base64     TEXT,
    sent_at        TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );
  INSERT INTO partes_v2 (id, tech, empresa, direccion, contacto, telefono, email_cliente,
    email_para, email_cc, fecha, hora_entrada, hora_salida, total_horas, desplazamiento,
    descripcion, pendiente, mats, fotos, status, pdf_base64, created_at, updated_at)
  SELECT id, tech, empresa, direccion, contacto, telefono, email_cliente,
    email_para, email_cc,
    CASE WHEN fecha LIKE '__/__/____'
         THEN substr(fecha, 7, 4) || '-' || substr(fecha, 4, 2) || '-' || substr(fecha, 1, 2)
         ELSE fecha END,
    hora_entrada, hora_salida, total_horas, desplazamiento,
    descripcion, pendiente, mats, fotos, status, pdf_base64, created_at, updated_at
  FROM partes;
  DROP TABLE partes;
  ALTER TABLE partes_v2 RENAME TO partes;
  CREATE INDEX idx_partes_tech ON partes(tech);
  `,
];

function openDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

module.exports = { openDb };
