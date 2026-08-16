const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionDir = __dirname;

function readExtensionFile(fileName) {
  return fs.readFileSync(path.join(extensionDir, fileName), 'utf8');
}

test('popup workflows do not use native confirm or prompt dialogs', () => {
  const popupSource = readExtensionFile('popup.js');
  const nativeDialogCalls = popupSource.match(/\b(?:confirm|prompt)\s*\(/g) || [];

  assert.deepEqual(nativeDialogCalls, []);
});

test('popup dialog helper loads before popup workflow code', () => {
  const popupHtml = readExtensionFile('popup.html');
  const dialogScriptIndex = popupHtml.indexOf('popup-dialog.js');
  const popupScriptIndex = popupHtml.indexOf('popup.js');

  assert.notEqual(dialogScriptIndex, -1);
  assert.notEqual(popupScriptIndex, -1);
  assert.ok(dialogScriptIndex < popupScriptIndex);
});

test('site action edit menu item is labelled 修改', () => {
  const popupSource = readExtensionFile('popup.js');

  assert.match(popupSource, /rename\.textContent\s*=\s*'修改'/);
  assert.doesNotMatch(popupSource, /rename\.textContent\s*=\s*'修改名称'/);
});
