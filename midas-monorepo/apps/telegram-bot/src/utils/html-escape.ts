/**
 * HTML Escape Utility — re-export shim (Phase 5.1-Pre)
 *
 * Implementation moved to @midas/shared so voice-parse.worker.ts can also
 * import it without crossing the app boundary.
 *
 * All existing imports of '../utils/html-escape.js' continue to work
 * unchanged — this file acts as a transparent pass-through.
 */
export { escapeHtml } from '@midas/shared';

