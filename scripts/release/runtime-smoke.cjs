const assert = require('node:assert/strict');
const fs = require('node:fs');
assert.notEqual(process.getuid(), 0, 'Image must execute as non-root');
const temporary = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'wfm-release-'));
fs.writeFileSync(`${temporary}/probe`, 'non-root temporary files');
fs.unlinkSync(`${temporary}/probe`); fs.rmdirSync(temporary);
if (process.cwd() === '/app') {
  for (const directory of ['logs', 'results', 'data', 'data/visual-baselines', 'uploads', 'allure-results']) {
    const path = `${directory}/release-smoke`;
    fs.writeFileSync(path, 'non-root runtime'); fs.unlinkSync(path);
  }
  const version = require('node:child_process').execFileSync(process.env.LIGHTHOUSE_BIN, ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, '12.8.2');
}
(async () => {
  const browser = await require('playwright').chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Release runtime</h1>');
    assert.equal(await page.locator('h1').textContent(), 'Release runtime');
  } finally { await browser.close(); }
  console.log(JSON.stringify({ uid: process.getuid(), node: process.version, playwright: require('playwright/package.json').version, writableRuntime: true, chromium: 'passed' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
