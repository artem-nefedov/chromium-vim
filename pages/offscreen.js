// Offscreen document: performs clipboard read/write on behalf of the service
// worker, which has no DOM. Driven by messages from background clipboard.js.
var textarea = document.getElementById('clipboard');

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.target !== 'offscreen-clipboard')
    return;
  switch (request.action) {
  case 'copy':
    textarea.value = request.text;
    textarea.select();
    document.execCommand('copy');
    sendResponse();
    break;
  case 'paste':
    textarea.value = '';
    textarea.focus();
    document.execCommand('paste');
    sendResponse(textarea.value);
    break;
  }
  return true;
});
