const GitScanner = require('./src/gitScanner');
const scanner = new GitScanner({ rootDirs: ['d:/'], maxDepth: 3 });
const repos = scanner.scan();
console.log('Found repos:', repos.length);
const bad = repos.filter(p => /recycle\.bin|system volume information|\$winreagent|lost\+found|\.trash/i.test(p));
console.log('System-dir leaks:', bad.length);
bad.forEach(p => console.log('  LEAK:', p));
// 顺便看一下前几条
console.log('First 5 repos:');
repos.slice(0, 5).forEach(p => console.log('  ', p));
