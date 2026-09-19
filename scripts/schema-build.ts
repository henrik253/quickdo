/**
 * Writes schema/{item,todos,schedule,inbox-command}.schema.json from the zod schemas in
 * src/domain/schema. `npm run schema:build`; CI fails when the committed files are stale
 * (src/domain/schema/schema.test.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJsonSchema, JSON_SCHEMAS, type JsonSchemaName } from '../src/domain/schema/index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'schema');
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(JSON_SCHEMAS) as JsonSchemaName[]) {
  const file = join(outDir, `${name}.schema.json`);
  writeFileSync(file, `${JSON.stringify(buildJsonSchema(name), null, 2)}\n`);
  console.log(`wrote ${file}`);
}
