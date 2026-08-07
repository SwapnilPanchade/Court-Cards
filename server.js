/**
 * Legacy Express + Socket.IO server.
 * Production and local default are Cloudflare Workers (`npm start` → wrangler).
 * Kept temporarily for reference; not used by package.json scripts.
 */
import { createRequire } from "node:module";
console.error("Use `npm start` (wrangler dev) or `npm run deploy`. See DEPLOY.md.");
console.error("This Express server is deprecated.");
process.exit(1);
