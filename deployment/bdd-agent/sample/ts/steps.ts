import {
  Given,
  Then,
  Before,
  World,
  setWorldConstructor,
  type IWorldOptions,
} from '@cucumber/cucumber';
class SampleWorld extends World {
  total = 0;
  constructor(options: IWorldOptions) {
    super(options);
  }
}
setWorldConstructor(SampleWorld);
Before(function (this: SampleWorld) {
  this.total = 0;
});
Given('I add {int} and {int}', function (this: SampleWorld, a: number, b: number) {
  this.total = a + b;
});
Then('the total is {int}', function (this: SampleWorld, expected: number) {
  if (this.total !== expected) throw new Error('Unexpected total');
});
