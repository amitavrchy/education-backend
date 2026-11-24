/* global process, console */
// Copies the frontend's typed contracts (the source of truth) into src/contracts.
// Run from the backend folder with the frontend repo next to it: npm run contracts:sync
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const from = join(process.cwd(), process.env.FRONTEND_DIR ?? '../frontend', 'src', 'contracts');
const to = join(process.cwd(), 'src', 'contracts');
for (const file of readdirSync(from).filter((f) => f.endsWith('.ts'))) {
  const body = readFileSync(join(from, file), 'utf8')
    .replace(/from "@\/types\/user"/g, 'from "./user.js"')
    .replace(/from "\.\/([a-z-]+)"/g, 'from "./$1.js"');
  writeFileSync(join(to, file), `// Mirrored from frontend/src/contracts/${file} — the frontend contract is the source of truth.\n// Refresh with: npm run contracts:sync\n${body}`);
  console.log(`synced ${file}`);
}
