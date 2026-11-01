// Personal data never enters the repo (see CLAUDE.md). This catches the obvious accidents: a chat
// export copied in, or a file generated from one. It can't prove a file is free of personal data.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dev-dist', '.claude']);
const BINARY = /\.(png|woff2|ico)$/;

/** Telegram names export files messages.html, messages2.html and so on. */
const EXPORT_FILE = /(^|\/)(messages\d*\.html|ChatExport[^/]*|result\.json)(\/|$)/;
/** A private folder or a path on someone's machine, spelled out in a file. */
const PRIVATE_TEXT = /ChatExport_|\/Downloads\/|\/Users\/[a-z]/;

function repoFiles(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : repoFiles(join(dir, entry.name));
    return [relative(ROOT, join(dir, entry.name))];
  });
}

describe('the repository', () => {
  const files = repoFiles();

  it('finds the source tree', () => {
    expect(files).toContain('package.json');
  });

  it('has no chat export in it', () => {
    expect(files.filter((f) => EXPORT_FILE.test(f))).toEqual([]);
  });

  it('has no private paths in its text files', () => {
    const self = relative(ROOT, import.meta.filename);
    const found = files.filter(
      (f) => f !== self && f !== 'package-lock.json' && !BINARY.test(f) && PRIVATE_TEXT.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    expect(found).toEqual([]);
  });
});
