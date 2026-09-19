/**
 * src/domain must stay pure so the browser can run the shared reducer for optimistic updates and
 * every rule is testable without I/O. tsconfig.domain.json enforces the type side (no node types);
 * this test enforces the import side for every non-test file under src/domain.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DOMAIN_DIR = fileURLToPath(new URL('./', import.meta.url));

const FORBIDDEN_PREFIXES = ['node:'];
const FORBIDDEN_MODULES = [
  'fs',
  'fs/promises',
  'path',
  'os',
  'child_process',
  'process',
  'react',
  'react-dom',
  'hono',
  'zustand',
  'vitest',
  'fast-check',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** Every module specifier in static imports/exports, dynamic import() and require() calls. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  return out;
}

function isForbidden(spec: string): boolean {
  if (FORBIDDEN_PREFIXES.some((p) => spec.startsWith(p))) return true;
  return FORBIDDEN_MODULES.some((m) => spec === m || spec.startsWith(`${m}/`));
}

describe('domain purity', () => {
  const files = walk(DOMAIN_DIR);

  it('[F-001] finds the domain sources', () => {
    const names = files.map((f) => relative(DOMAIN_DIR, f));
    expect(names).toEqual(
      expect.arrayContaining(['state/reducer.ts', 'state/derive.ts', 'time.ts', 'schema/index.ts']),
    );
  });

  it('[F-001] no non-test file in src/domain imports node, react, hono or zustand', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const spec of specifiersOf(source)) {
        if (isForbidden(spec)) offenders.push(`${relative(DOMAIN_DIR, file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('[F-001] no non-test file in src/domain touches process.env or the ambient wall clock', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/\bprocess\.env\b/.test(source))
        offenders.push(`${relative(DOMAIN_DIR, file)} -> process.env`);
      if (/\bDate\.now\s*\(/.test(source))
        offenders.push(`${relative(DOMAIN_DIR, file)} -> Date.now()`);
      if (/\bnew Date\s*\(\s*\)/.test(source))
        offenders.push(`${relative(DOMAIN_DIR, file)} -> new Date()`);
    }
    expect(offenders).toEqual([]);
  });

  it('[F-001] the specifier scanner catches every import form', () => {
    const sample = `
      import { x } from 'node:fs';
      import type { Y } from "react";
      import 'zustand/vanilla';
      export * from 'hono';
      const p = await import('path');
      const q = require("child_process");
      import { ok } from '../types';
    `;
    expect(specifiersOf(sample).filter(isForbidden)).toEqual([
      'node:fs',
      'react',
      'hono',
      'zustand/vanilla',
      'path',
      'child_process',
    ]);
  });
});
