const fs = require('fs');
const path = require('path');

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// Carga los técnicos desde un JSON fuera del código (config/tecnicos.json).
// Así los datos personales (NIF, móvil, firma) no acaban en el HTML ni en git.
function loadTecnicos(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`No existe ${file}. Copia config/tecnicos.example.json a config/tecnicos.json.`);
  }
  const { tecnicos } = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const dir = path.dirname(file);
  const byId = new Map();

  for (const t of tecnicos) {
    if (!t.id || !t.passwordHash) throw new Error(`Técnico sin id o sin passwordHash en ${file}`);
    let firma = null;
    if (t.firma) {
      const img = path.join(dir, t.firma);
      const mime = MIME[path.extname(img).toLowerCase()] || 'application/octet-stream';
      firma = `data:${mime};base64,${fs.readFileSync(img).toString('base64')}`;
    }
    byId.set(t.id, { ...t, firma });
  }

  return {
    get: (id) => byId.get(id),
    // Lo mínimo para la pantalla de login (sin sesión).
    publicList: () => [...byId.values()].map(({ id, nombre, nombreCorto, iniciales, empresa, color }) =>
      ({ id, nombre, nombreCorto, iniciales, empresa, color })),
    // El perfil completo solo se envía al técnico autenticado.
    perfil: (id) => {
      const t = byId.get(id);
      if (!t) return null;
      const { passwordHash, ...rest } = t;
      return rest;
    },
  };
}

module.exports = { loadTecnicos };
