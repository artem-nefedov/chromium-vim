// MV3 service-worker entry point.
//
// cVim's background logic was originally a persistent background page: 15
// <script> tags sharing globals across a single page context. Rather than
// introduce a bundler, we preserve that model with a classic (importScripts)
// service worker — load order and cross-file globals behave exactly as they did
// on the background page.
//
// Several files are shared with the content-script context and assign to
// `window.*` (utils.js `window.parseConfig`, main.js `window.httpRequest`,
// options.js `window.setTimeout`). A worker has no `window`, so alias it to the
// worker global before importing. DOM-only helpers inside those files
// (document/getComputedStyle/Node) are never *called* in the worker, so simply
// defining them is harmless.
self.window = self;

importScripts(
  'content_scripts/utils.js',
  'content_scripts/cvimrc_parser.js',
  'background_scripts/clipboard.js',
  'background_scripts/bookmarks.js',
  'background_scripts/sites.js',
  'background_scripts/files.js',
  'background_scripts/links.js',
  'background_scripts/history.js',
  'background_scripts/actions.js',
  'background_scripts/main.js',
  'background_scripts/options.js',
  'background_scripts/sessions.js',
  'background_scripts/popup.js',
  'background_scripts/update.js',
  'background_scripts/tab_creation_order.js',
  'background_scripts/frames.js'
);
