const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backgroundPath = path.join(__dirname, 'background.js');

function readBackground() {
  return fs.readFileSync(backgroundPath, 'utf8');
}

function getFunctionBody(source, name) {
  const marker = `async function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index++) {
    const char = source[index];
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;
    if (char === '{' && parenDepth === 0) {
      bodyStart = index;
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body should exist`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  throw new Error(`Could not extract ${name}`);
}

test('background loads page automation helpers before using tab automation', () => {
  const source = readBackground();

  assert.match(source, /importScripts\([^)]*'page-automation\.js'[^)]*\)/);
  assert.ok(
    source.indexOf("'page-automation.js'") < source.indexOf("'newapi-auth.js'"),
    'page automation helpers should load before auth helpers so login classifiers can be shared'
  );
});

test('Sub2API check-in orchestration is page-first and does not call check-in endpoints directly', () => {
  const source = readBackground();
  const body = getFunctionBody(source, 'checkInSub2ApiSite');

  assert.match(body, /checkInSub2ApiFromOfficialPage/);
  assert.doesNotMatch(body, /requestSub2ApiCheckIn/);
});

test('official page check-in supports dialog cleanup and forced refresh options', () => {
  const source = readBackground();
  const body = getFunctionBody(source, 'checkInFromOfficialPage');

  assert.match(body, /cleanupOrdinaryDialogs/);
  assert.match(body, /forceRefreshBeforeBalance/);
  assert.match(body, /shouldRefreshBalanceAfterPageResult/);
});

test('temporary automation tabs start and stop human verification monitoring', () => {
  const source = readBackground();
  const createBody = getFunctionBody(source, 'createTemporaryBackgroundTab');
  const closeBody = getFunctionBody(source, 'closeTabQuietly');

  assert.match(createBody, /startAutomationHumanVerificationMonitor/);
  assert.match(closeBody, /stopAutomationHumanVerificationMonitor/);
});

test('automation monitor records target-site login page state continuously', () => {
  const source = readBackground();
  const startBody = source.slice(source.indexOf('function startAutomationHumanVerificationMonitor'));
  const probeBody = getFunctionBody(source, 'probeAutomationTabHumanVerification');

  assert.match(startBody, /targetDomain/);
  assert.match(startBody, /latestLoginPage/);
  assert.match(probeBody, /recordAutomationLoginPageState/);
  assert.match(source, /function getAutomationLoginPageState/);
});

test('background login recovery tries sign-in route variants', () => {
  const source = readBackground();
  const body = source.slice(source.indexOf('function getTargetSiteLoginCandidateUrls'));

  assert.match(body, /'\/login'/);
  assert.match(body, /'\/sign-in'/);
  assert.match(body, /'\/signin'/);
  assert.match(source, /navigateToTargetSiteLoginPage/);
});

test('site OAuth login click selects login agreements before clicking entry', () => {
  const source = readBackground();
  const body = getFunctionBody(source, 'clickSiteLinuxDoLoginButton');

  assert.match(body, /getLoginAgreementProbeConfig/);
  assert.match(body, /selectLoginAgreementCheckboxes/);
  assert.match(body, /agreementConfig/);
  assert.match(body, /controlSelectors/);
  assert.match(body, /aria-checked/);
  assert.match(body, /aria-labelledby/);
});
