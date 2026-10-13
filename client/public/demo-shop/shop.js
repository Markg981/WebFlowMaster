/*
 * Northwind Shop: the storefront the sample project tests (server/authoring/sample-project.ts)
 * and the promo video films. A file of its own, not inline scripts, because the application
 * serves it under its Content Security Policy, which allows scripts from 'self' only.
 * Each page wires what it has.
 */
(function () {
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var ok =
        document.getElementById('username').value === 'maya.chen' &&
        document.getElementById('password').value === 'Coffee-2026';
      var flash = document.getElementById('flash');
      flash.className = 'flash ' + (ok ? 'ok' : 'err');
      flash.textContent = ok ? 'Welcome back, Maya!' : 'Wrong username or password.';
    });
  }

  var shipping = document.getElementById('shipping');
  if (shipping) {
    var costs = { standard: '€4.90', express: '€9.90', pickup: 'Free' };
    shipping.addEventListener('change', function (event) {
      document.getElementById('shipping-cost').textContent = costs[event.target.value];
    });
  }

  var placeOrder = document.getElementById('place-order');
  if (placeOrder) {
    placeOrder.addEventListener('click', function () {
      document.getElementById('progress').hidden = false;
      // The payment takes a moment, as a real one would: the test has to wait for it.
      setTimeout(function () {
        document.getElementById('progress').hidden = true;
        var confirmation = document.getElementById('confirmation');
        confirmation.textContent = 'Order confirmed · #NW-10428';
        confirmation.hidden = false;
      }, 1800);
    });
  }
})();
