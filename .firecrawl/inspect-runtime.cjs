const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.DSH_INSTALL_DIR, '..');
console.log(fs.readdirSync(root).filter(n => /client.*(workspace|layout|hook|slot|types)/.test(n)));
