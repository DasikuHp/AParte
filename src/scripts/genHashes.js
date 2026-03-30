const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Uso: node genHashes.js PASSWORD_LAURA PASSWORD_CARLOS');
  process.exit(1);
}

const hashLaura = bcrypt.hashSync(args[0], 12);
const hashCarlos = bcrypt.hashSync(args[1], 12);

console.log('');
console.log('Copia estas líneas en tu .env:');
console.log('');
console.log('HASH_LAURA=' + hashLaura);
console.log('HASH_CARLOS=' + hashCarlos);
console.log('');
