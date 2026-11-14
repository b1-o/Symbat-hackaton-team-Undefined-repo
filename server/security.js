import { createHash } from 'node:crypto';
// Exact Vite 6 / plugin-react 4 preamble; the browser smoke test guards this contract.
// Keep the development exception out of the production dependency graph.
const developmentPreambleHash = createHash('sha256')
  .update(
    `import { injectIntoGlobalHook } from "/@react-refresh";\ninjectIntoGlobalHook(window);\nwindow.$RefreshReg$ = () => {};\nwindow.$RefreshSig$ = () => (type) => type;`,
  )
  .digest('base64');
export function contentSecurityPolicy(development = false) {
  return [
    "default-src 'self'",
    `script-src 'self'${development ? ` 'unsafe-eval' 'sha256-${developmentPreambleHash}'` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'" + (development ? ' ws: wss:' : ''),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
