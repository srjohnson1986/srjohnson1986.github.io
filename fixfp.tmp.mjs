import fs from 'node:fs';
function edit(file, from, to, all = false) {
  let s = fs.readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n');
  if (!s.includes(from)) throw new Error('not found in ' + file + ': ' + from.slice(0, 60));
  s = all ? s.split(from).join(to) : s.replace(from, to);
  fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
}
edit('src/lib/resume.ts',
  "const printCssHash = () => createHash('sha1').update(fs.readFileSync('src/styles/print.css')).digest('hex').slice(0, 12);",
  "// Line endings are normalized first: a Windows checkout has CRLF and the CI runner has LF, and they must give the same hash.\nconst printCssHash = () => createHash('sha1').update(fs.readFileSync('src/styles/print.css', 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);\n\n// Plain code-point order, so every machine sorts ids the same way whatever its locale.\nconst byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);");
edit('src/lib/resume.ts', "  const planBullets = [...bulletEntries]\n    .sort((a, b) => a.id.localeCompare(b.id))", "  const planBullets = [...bulletEntries]\n    .sort(byId)");
edit('src/lib/resume.ts', "  const planCombos = [...comboEntries]\n    .sort((a, b) => a.id.localeCompare(b.id))", "  const planCombos = [...comboEntries]\n    .sort(byId)");
edit('src/lib/lane-fit.js', "const norm = (s) => s.replace(/\s+/g, ' ').trim();", "const norm = (s) => s.replace(/\s+/g, ' ').trim();\n// Plain code-point order, so every machine sorts the same way whatever its locale.\nconst cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);");
edit('src/lib/lane-fit.js', "|| roleOrder.indexOf(a) - roleOrder.indexOf(b) || a.localeCompare(b),", "|| roleOrder.indexOf(a) - roleOrder.indexOf(b) || cmp(a, b),");
edit('src/lib/lane-fit.js', "return a.role.localeCompare(b.role) || a.tier - b.tier", "return cmp(a.role, b.role) || a.tier - b.tier");
edit('tests/lane-resumes.spec.ts', "bullets: [...bullets].sort((a, b) => a.id.localeCompare(b.id)),\n    combos: [...combos].sort((a, b) => a.id.localeCompare(b.id)),", "bullets: [...bullets].sort(byId),\n    combos: [...combos].sort(byId),");
edit('tests/lane-resumes.spec.ts', "// Newest first, written out again here", "const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);\n\n// Newest first, written out again here");
