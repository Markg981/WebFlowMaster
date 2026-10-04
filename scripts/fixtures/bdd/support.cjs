const { Given, Then, Before, After, setWorldConstructor, World } = require('@cucumber/cucumber');
class CustomWorld extends World {
  constructor(options) {
    super(options);
    this.before = false;
  }
}
setWorldConstructor(CustomWorld);
Before(function () {
  this.before = true;
  if (this.parameters.failHook) throw new Error('Before failed');
});
After(function () {
  if (!this.before) throw new Error('Before hook was omitted');
});
Given('row {int}', function (row) {
  if (row !== 2) throw new Error('Unselected row executed');
  this.row = row;
});
Given('document:', function (text) {
  if (text !== 'payload 2') throw new Error('Wrong doc string');
});
Then('table:', function (table) {
  if (table.raw()[0][0] !== '2' || !this.before || this.parameters.value !== 'world')
    throw new Error('Wrong DataTable or World');
});
Given('ambiguous', function () {});
Given('ambiguous', function () {});
Given('pending', function () {
  return 'pending';
});
Given('hang', function () {
  return new Promise(() => {});
});
Given('exit early', function () {
  process.exit(0);
});
Given('credentials', function () {
  throw new Error(
    'password=supersecret token=supersecret ' + process.cwd() + ' ' + this.parameters.password,
  );
});
Given('check environment', function () {
  if (
    process.env.WFM_AGENT_TOKEN ||
    process.env.NODE_OPTIONS ||
    process.env.NODE_ENV ||
    process.env.TEST_ALLOWED !== 'operator-value'
  )
    throw new Error('Environment leaked');
});
Given('oversize attachment', async function () {
  await this.attach('x'.repeat(1024 * 1024 + 1), 'text/plain');
});
Given('oversize output', function () {
  process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
});
Given('text attachment', async function () {
  await this.attach('password=supersecret ' + this.parameters.password, 'text/plain');
  await this.attach('<script>untrusted</script>', 'text/html');
});
Given('descendant', function () {
  const child = require('node:child_process').spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'ignore' },
  );
  child.unref();
  require('node:fs').writeFileSync(this.parameters.pidFile, String(child.pid));
});
Given('descendant hang', function () {
  const child = require('node:child_process').spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'ignore' },
  );
  child.unref();
  require('node:fs').writeFileSync(this.parameters.pidFile, String(child.pid));
  return new Promise(() => {});
});
Given('descendant inherited output', function () {
  const child = require('node:child_process').spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'inherit' },
  );
  child.unref();
  require('node:fs').writeFileSync(this.parameters.pidFile, String(child.pid));
});
