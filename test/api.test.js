const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');
const { loadTecnicos } = require('../src/tecnicos');
const { createApp } = require('../src/app');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

let server, base, tmp;
const mailer = { simulated: false, fail: false, sent: [] };
mailer.send = async (mail) => {
  if (mailer.fail) throw new Error('SMTP caído');
  mailer.sent.push(mail);
};

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aparte-test-'));
  const config = loadConfig({
    SESSION_SECRET: 'test',
    DB_PATH: ':memory:',
    UPLOADS_DIR: path.join(tmp, 'uploads'),
    TECNICOS_FILE: path.join(__dirname, '..', 'config', 'tecnicos.example.json'),
  });
  const app = createApp({ config, db: openDb(':memory:'), mailer, tecnicos: loadTecnicos(config.tecnicosFile) });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Cliente mínimo que guarda la cookie de sesión.
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie && { cookie }), ...(!isForm && body && { 'content-type': 'application/json' }), ...headers },
      body: isForm ? body : body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}

async function login(tech) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { tech, password: 'demo1234' });
  assert.equal(r.status, 200);
  return c;
}

test('la lista pública de técnicos no incluye datos personales', async () => {
  const r = await client()('GET', '/api/tecnicos');
  assert.equal(r.status, 200);
  const t = r.body.tecnicos[0];
  assert.ok(t.nombre);
  for (const campo of ['nif', 'movil', 'firma', 'passwordHash', 'direccion']) assert.equal(t[campo], undefined);
});

test('login con contraseña incorrecta devuelve 401', async () => {
  const r = await client()('POST', '/api/auth/login', { tech: 'laura', password: 'mal' });
  assert.equal(r.status, 401);
});

test('las rutas de partes y las fotos piden sesión', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/partes')).status, 401);
  assert.equal((await c('GET', '/uploads/x.png')).status, 401);
});

test('el perfil (con NIF y firma) solo llega tras el login', async () => {
  const c = await login('laura');
  const r = await c('GET', '/api/auth/me');
  assert.equal(r.body.perfil.id, 'laura');
  assert.ok(r.body.perfil.firma.startsWith('data:image/svg+xml;base64,'));
  assert.equal(r.body.perfil.passwordHash, undefined);
});

test('crear y reabrir un parte conserva todos los campos', async () => {
  const c = await login('laura');
  const datos = {
    tech: 'carlos', // se ignora: el técnico sale de la sesión
    empresa: 'Cliente Test', direccion: 'Calle 1', contacto: 'Ana', telefono: '600000000',
    emailCliente: 'a@example.com', emailPara: 'a@example.com', emailCC: 'b@example.com',
    fecha: '2026-03-27', horaEntrada: '09:00', horaSalida: '10:00', totalHoras: '1 H',
    desplazamiento: 'NO', descripcion: 'Prueba', pendiente: 'Nada',
    mats: [{ desc: 'Cable', qty: 2, price: 1.5 }], fotos: [],
    firmaCliente: 'data:image/png;base64,' + PNG_1PX,
  };
  const creado = await c('POST', '/api/partes', datos);
  assert.equal(creado.status, 201);
  assert.equal(creado.body.tech, 'laura');
  assert.equal(creado.body.status, 'draft');

  const leido = (await c('GET', `/api/partes/${creado.body.id}`)).body;
  for (const [k, v] of Object.entries(datos)) {
    if (k !== 'tech') assert.deepEqual(leido[k], v, `campo ${k}`);
  }
  assert.equal(leido.editable, true);
});

test('un técnico no puede modificar ni enviar partes de otro', async () => {
  const laura = await login('laura');
  const carlos = await login('carlos');
  const { body: parte } = await laura('POST', '/api/partes', { empresa: 'De Laura' });
  assert.equal((await carlos('PUT', `/api/partes/${parte.id}`, { empresa: 'Hackeado' })).status, 403);
  assert.equal((await carlos('DELETE', `/api/partes/${parte.id}`)).status, 403);
  assert.equal((await carlos('POST', `/api/partes/${parte.id}/send`, { para: 'x@example.com', pdfBase64: 'JVBER' })).status, 403);
  assert.equal((await carlos('GET', `/api/partes/${parte.id}`)).body.editable, false);
});

test('si el correo falla, el parte NO queda como enviado', async () => {
  const c = await login('laura');
  const { body: parte } = await c('POST', '/api/partes', { empresa: 'Fallo SMTP' });
  mailer.fail = true;
  const r = await c('POST', `/api/partes/${parte.id}/send`, { para: 'cliente@example.com', pdfBase64: 'JVBERi0xLjQ=' });
  mailer.fail = false;
  assert.equal(r.status, 502);
  assert.equal(r.body.emailSent, false);
  assert.equal((await c('GET', `/api/partes/${parte.id}`)).body.status, 'draft');
});

test('si el correo sale, el parte queda enviado con su PDF', async () => {
  const c = await login('laura');
  const { body: parte } = await c('POST', '/api/partes', { empresa: 'Envío OK' });
  const r = await c('POST', `/api/partes/${parte.id}/send`, { para: 'cliente@example.com', cc: 'jefe@example.com', pdfBase64: 'JVBERi0xLjQ=' });
  assert.equal(r.status, 200);
  assert.equal(r.body.parte.status, 'sent');
  assert.ok(r.body.parte.sentAt);
  assert.deepEqual(mailer.sent.at(-1).cc, ['jefe@example.com']);
  const pdf = await c('GET', `/api/partes/${parte.id}/pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');

  // Editar un parte enviado no lo devuelve a borrador.
  await c('PUT', `/api/partes/${parte.id}`, { empresa: 'Envío OK (corregido)' });
  assert.equal((await c('GET', `/api/partes/${parte.id}`)).body.status, 'sent');
});

test('el envío rechaza destinatarios no válidos', async () => {
  const c = await login('laura');
  const { body: parte } = await c('POST', '/api/partes', { empresa: 'Emails' });
  const r = await c('POST', `/api/partes/${parte.id}/send`, { para: 'no-es-un-email', pdfBase64: 'JVBER' });
  assert.equal(r.status, 400);
});

test('las fotos solo admiten imágenes y se sirven con nombre aleatorio', async () => {
  const c = await login('laura');
  const html = new FormData();
  html.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'x.html');
  assert.equal((await c('POST', '/api/upload', html)).status, 400);

  const png = new FormData();
  png.append('file', new Blob([Buffer.from(PNG_1PX, 'base64')], { type: 'image/png' }), '../../evil.png');
  const r = await c('POST', '/api/upload', png);
  assert.equal(r.status, 201);
  assert.match(r.body.url, /^\/uploads\/[0-9a-f-]{36}\.png$/);
  const foto = await c('GET', r.body.url);
  assert.equal(foto.status, 200);
  assert.equal(foto.headers.get('x-content-type-options'), 'nosniff');
});

test('migración: una BD con el esquema antiguo conserva sus partes', () => {
  const file = path.join(tmp, 'antigua.db');
  const { DatabaseSync } = require('node:sqlite');
  const vieja = new DatabaseSync(file);
  vieja.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf-8'));
  vieja.prepare("INSERT INTO partes (id, tech, empresa, fecha) VALUES ('p1', 'laura', 'Vieja', '27/03/2026')").run();
  vieja.close();

  const db = openDb(file);
  const row = db.prepare("SELECT * FROM partes WHERE id = 'p1'").get();
  assert.equal(row.empresa, 'Vieja');
  assert.equal(row.fecha, '2026-03-27');
  assert.ok('firma_cliente' in row);
  db.close();
});
