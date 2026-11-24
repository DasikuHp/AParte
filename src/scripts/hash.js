// Genera el passwordHash de un técnico para config/tecnicos.json.
// Uso: npm run hash -- MI_CONTRASEÑA
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.log('Uso: npm run hash -- MI_CONTRASEÑA');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
