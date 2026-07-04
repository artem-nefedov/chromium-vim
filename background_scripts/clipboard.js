// The service worker has no DOM, so clipboard read/write is delegated to an
// offscreen document (see pages/offscreen.{html,js}). Both operations are async
// because creating/messaging the offscreen document is async; `copy` fires and
// forgets, while `paste` takes a callback.
var Clipboard = {};

Clipboard.CREATING = null; // in-flight offscreen-document creation promise

Clipboard.ensureDocument = function() {
  return clipboard_hasDocument().then(function(has) {
    if (has)
      return;
    if (Clipboard.CREATING)
      return Clipboard.CREATING;
    Clipboard.CREATING = chrome.offscreen.createDocument({
      url: 'pages/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Read and write the system clipboard for yank/paste.'
    }).then(function() {
      Clipboard.CREATING = null;
    });
    return Clipboard.CREATING;
  });
};

function clipboard_hasDocument() {
  // hasDocument() is only available in newer Chromium; fall back to getContexts.
  if (chrome.offscreen && chrome.offscreen.hasDocument)
    return chrome.offscreen.hasDocument();
  return chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  }).then(function(contexts) {
    return contexts.length > 0;
  });
}

Clipboard.copy = function(text) {
  Clipboard.ensureDocument().then(function() {
    chrome.runtime.sendMessage({
      target: 'offscreen-clipboard',
      action: 'copy',
      text: text
    });
  });
};

Clipboard.paste = function(callback) {
  Clipboard.ensureDocument().then(function() {
    chrome.runtime.sendMessage({
      target: 'offscreen-clipboard',
      action: 'paste'
    }, function(text) {
      if (callback)
        callback(text || '');
    });
  });
};
