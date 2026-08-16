const test = require('node:test');
const assert = require('node:assert/strict');

require('./page-automation.js');

const {
  isNewApiTargetLoginPage
} = require('./newapi-auth.js');
const {
  isSub2ApiTargetLoginPage
} = require('./sub2api-auth.js');
const {
  isZenApiTargetLoginPage
} = require('./zenapi-auth.js');

test('site auth helpers share login route classification', () => {
  assert.equal(isNewApiTargetLoginPage('https://new.example.com/sign-in', 'new.example.com'), true);
  assert.equal(isSub2ApiTargetLoginPage('https://sub.example.com/signin', 'sub.example.com'), true);
  assert.equal(isZenApiTargetLoginPage('https://zen.example.com/sign-in/continue', 'zen.example.com'), true);
});

test('site auth helpers preserve OAuth callback exclusions on login-like routes', () => {
  assert.equal(isNewApiTargetLoginPage('https://new.example.com/sign-in?code=abc&state=xyz', 'new.example.com'), false);
  assert.equal(isSub2ApiTargetLoginPage('https://sub.example.com/signin?auth_token=abc.def', 'sub.example.com'), false);
  assert.equal(isZenApiTargetLoginPage('https://zen.example.com/sign-in?linuxdo_token=abc.def', 'zen.example.com'), false);
});
