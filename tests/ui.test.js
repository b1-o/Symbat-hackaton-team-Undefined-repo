import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Browser-free UI check: mounts the real pages, clicks the real handlers, asserts the real requests.
// Playwright covers the same flows end to end when a browser is available (npm run test:e2e).
test('cabinets render and their actions call the API', async (t) => {
  // Keep the bundle inside node_modules so it resolves the app's own React copy.
  const dir = path.resolve('node_modules/.cache/startify-ui');
  fs.mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, `ui-smoke-${process.pid}.mjs`);
  t.after(() => fs.rmSync(outfile, { force: true }));
  await build({
    entryPoints: [path.resolve('tests/fixtures/ui-smoke.jsx')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    outfile,
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', 'node:assert/strict'],
    loader: { '.png': 'dataurl', '.css': 'empty' },
    logLevel: 'silent',
    // CJS icon builds call require(); give the ESM bundle a real one.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://sprint.test/?from=school-kz-demo#/teacher',
    pretendToBeVisual: true,
  });
  const saved = {};
  for (const key of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    saved[key] = globalThis[key];
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    dom.window.close();
  });

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => {
    errors.push(args.join(' '));
    originalError(...args);
  };
  t.after(() => {
    console.error = originalError;
  });

  const { run } = await import(pathToFileURL(outfile).href);
  const calls = await run();
  assert.ok(calls > 5, 'pages made too few API calls');
  const real = errors.filter((e) => !e.includes('not wrapped in act') && !e.includes('ReactDOMTestUtils'));
  assert.deepEqual(real, [], 'React reported errors while rendering the cabinets');
});
