const { Given, Then, Before, World, setWorldConstructor } = require('@cucumber/cucumber');
class SampleWorld extends World {
  constructor(options) {
    super(options);
    this.total = 0;
  }
}
setWorldConstructor(SampleWorld);
Before(function () {
  this.total = 0;
});
Given('I add {int} and {int}', function (a, b) {
  this.total = a + b;
});
Then('the total is {int}', function (expected) {
  if (this.total !== expected) throw new Error('Unexpected total');
});
