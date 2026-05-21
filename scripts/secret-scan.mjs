import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'uploads']);
const strongPatterns = [
  [/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, 'JWT'],
  [/service_role[_-]?[a-zA-Z0-9_.-]{20,}/i, 'Supabase service role key'],
  [/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i, 'Database URL with password']
];
const envPatterns = [
  [/^(?:[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*)\s*=\s*(?!TU_|CAMBIA_|https:\/\/hooks\.example\.com)[^#\s]{16,}/i, 'Possible secret in env-like line']
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

let findings = 0;
for (const file of walk(root)) {
  if (file.endsWith('.lock') || file.endsWith('.docx') || file.endsWith('.db') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) continue;
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const isExample = relative.endsWith('.env.example');
  const isEnvFile = path.basename(file).startsWith('.env') && !relative.endsWith('.env.example');
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [pattern, label] of strongPatterns) {
      if (!isExample && pattern.test(line)) {
        findings += 1;
        console.error(`${relative}:${index + 1} ${label}`);
      }
    }
    if (!isEnvFile) return;
    for (const [pattern, label] of envPatterns) {
      if (pattern.test(line)) {
        findings += 1;
        console.error(`${relative}:${index + 1} ${label}`);
      }
    }
  });
}

if (findings) {
  console.error(`Encontrados ${findings} posibles secretos. Rota las claves expuestas y elimina el valor del repo.`);
  process.exitCode = 1;
} else {
  console.log('OK no se detectaron secretos obvios en archivos versionables.');
}
