const { Given, Then, Before } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
Before(function () { assert.equal(process.env.WFM_AGENT_TOKEN, undefined); });
Given('selected count {int}', function (count) { this.count = count; });
Given('a document:', function (document) { assert.equal(document, 'payload 2'); });
Then('a table:', function (table) { assert.deepEqual(table.raw(), [['2']]); });
Then('the selected count is two', function () {
  assert.equal(this.count, 2);
  assert.ok(this.parameters.label);
  this.attach(`<script>unsafe()</script> row=${this.parameters.label} Authorization: Bearer fixture-generated-secret`, 'text/plain');
});
