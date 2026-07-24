// Claude Code PostToolUse hook: typecheck after TypeScript edits so compile
// errors surface immediately instead of at build time. Exit 2 feeds the
// compiler output back to Claude; exit 0 stays silent.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const file = input.tool_input?.file_path ?? '';
    // Only edits to TypeScript files need a typecheck.
    if (file && !/\.[mc]?tsx?$/i.test(file)) process.exit(0);
  } catch {
    // No/odd stdin payload — typecheck anyway.
  }
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/lib/tsc.js');
  const r = spawnSync(process.execPath, [tsc, '--noEmit'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error((r.stdout ?? '') + (r.stderr ?? ''));
    process.exit(2);
  }
});
