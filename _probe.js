const fs = require('fs');
const path = require('path');
const dir = process.argv[2] || 'd:/';
console.log('Scanning', dir);
try {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const nameUpper = e.name.toUpperCase();
    if (nameUpper.includes('RECYCLE') || nameUpper.includes('SYSTEM VOLUME')) {
      const isHidden = typeof e.isHidden === 'function' ? e.isHidden() : 'N/A';
      console.log('FOUND:', e.name, '| isDir=', e.isDirectory(), '| isHidden=', isHidden);
    }
  }
} catch (e) {
  console.log('ERR:', e.message);
}
