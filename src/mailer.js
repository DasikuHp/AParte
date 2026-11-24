const nodemailer = require('nodemailer');

// Devuelve { send(mail), simulated }.
// Sin SMTP configurado (o en modo demo) no se envía nada: el correo se genera
// en memoria y la respuesta lo indica, para no engañar al usuario.
function createMailer(config) {
  const simulated = config.demo || !config.smtp.host;

  const transporter = simulated
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      });

  return {
    simulated,
    send: (mail) => transporter.sendMail({ from: config.smtp.from || 'partes@localhost', ...mail }),
  };
}

module.exports = { createMailer };
