// Crea partes ficticios para probar la app o para el modo demo.
// Uso: npm run seed   (solo añade datos si la tabla está vacía)
const crypto = require('crypto');

const DEMO = [
  {
    tech: 'laura', status: 'sent', dias: 1, empresa: 'Gestoría Ejemplo', direccion: 'Calle Mayor 10, Valencia',
    contacto: 'Marta', telefono: '600 111 222', emailCliente: 'gestoria@example.com',
    horaEntrada: '09:00', horaSalida: '10:30', totalHoras: '1 H 30\'', desplazamiento: 'SI',
    descripcion: 'Sustitución del router y configuración de la red wifi de invitados.',
    pendiente: 'Presupuestar un segundo punto de acceso para la planta de arriba.',
    mats: [{ desc: 'Router wifi 6', qty: 1, price: 89.9 }, { desc: 'Latiguillo cat6 2 m', qty: 2, price: 3.5 }],
  },
  {
    tech: 'laura', status: 'draft', dias: 0, empresa: 'Clínica Dental Demo', direccion: 'Av. del Puerto 25, Valencia',
    contacto: 'Jorge', telefono: '600 333 444', emailCliente: 'recepcion@example.org',
    horaEntrada: '12:00', horaSalida: '13:00', totalHoras: '1 H', desplazamiento: 'SI',
    descripcion: 'Revisión del equipo de recepción: limpieza, actualización de Windows y copia de seguridad.',
    pendiente: '', mats: [],
  },
  {
    tech: 'carlos', status: 'sent', dias: 3, empresa: 'Comunidad de Vecinos Prueba 4', direccion: 'Calle Prueba 4, Moncada',
    contacto: 'Presidente de la comunidad', telefono: '600 555 666', emailCliente: 'comunidad@example.net',
    horaEntrada: '16:00', horaSalida: '18:15', totalHoras: '2 H 15\'', desplazamiento: 'SI',
    descripcion: 'Cambio de placa de calle del videoportero y ajuste de la cerradura eléctrica.',
    pendiente: 'Revisar el monitor del 3.º B, que no recibe imagen.',
    mats: [{ desc: 'Placa de calle 2 líneas', qty: 1, price: 145 }, { desc: 'Abrepuertas eléctrico', qty: 1, price: 32.4 }],
  },
  {
    tech: 'carlos', status: 'draft', dias: 6, empresa: 'Bar Ejemplo', direccion: 'Plaza Nueva 2, Valencia',
    contacto: 'Ana', telefono: '600 777 888', emailCliente: '',
    horaEntrada: '08:30', horaSalida: '09:15', totalHoras: '45\'', desplazamiento: 'NO',
    descripcion: 'Instalación de una cámara IP en la barra.', pendiente: '', mats: [],
  },
];

function isoDaysAgo(dias) {
  return new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
}

function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM partes').get().n > 0) return 0;
  const insert = db.prepare(`INSERT INTO partes (id, tech, empresa, direccion, contacto, telefono,
    email_cliente, email_para, fecha, hora_entrada, hora_salida, total_horas, desplazamiento,
    descripcion, pendiente, mats, fotos, status, sent_at, created_at, updated_at)
    VALUES (@id, @tech, @empresa, @direccion, @contacto, @telefono, @email_cliente, @email_para,
    @fecha, @hora_entrada, @hora_salida, @total_horas, @desplazamiento, @descripcion, @pendiente,
    @mats, '[]', @status, @sent_at, @creado, @creado)`);
  for (const p of DEMO) {
    const fecha = isoDaysAgo(p.dias);
    const creado = `${fecha} 18:00:00`;
    insert.run({
      id: crypto.randomUUID(), tech: p.tech, empresa: p.empresa, direccion: p.direccion,
      contacto: p.contacto, telefono: p.telefono, email_cliente: p.emailCliente, email_para: p.emailCliente,
      fecha, hora_entrada: p.horaEntrada, hora_salida: p.horaSalida, total_horas: p.totalHoras,
      desplazamiento: p.desplazamiento, descripcion: p.descripcion, pendiente: p.pendiente,
      mats: JSON.stringify(p.mats), status: p.status, sent_at: p.status === 'sent' ? creado : null, creado,
    });
  }
  return DEMO.length;
}

if (require.main === module) {
  require('dotenv').config();
  const { loadConfig } = require('../config');
  const { openDb } = require('../db');
  const n = seedIfEmpty(openDb(loadConfig().dbPath));
  console.log(n ? `Creados ${n} partes de ejemplo.` : 'La base de datos ya tiene partes; no se ha tocado.');
}

module.exports = { seedIfEmpty };
