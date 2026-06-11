const fs = require('fs');
console.log('Node:', process.version);
console.log('Platform:', process.platform);
const entries = fs.readdirSync('d:/', { withFileTypes: true });
console.log('First entry keys:', Object.keys(entries[0]));
console.log('Dirent proto methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(entries[0])));
const e = entries.find(x => x.name === '$RECYCLE.BIN');
if (e) {
  console.log('$RECYCLE.BIN entry:', { name: e.name, isDir: e.isDirectory(), isHidden: typeof e.isHidden, isFile: typeof e.isFile, isBlockDevice: typeof e.isBlockDevice });
}
