import http from 'node:http';

const PAGE = `<!doctype html><html><body style="font-family:sans-serif">
  <h1 id="title">Start page</h1>
  <button id="open-modal">Open the dialog</button>
  <a id="go-second" href="/second">Go to the second page</a>
  <div id="modal-root"></div>
  <script>
    document.getElementById('open-modal').addEventListener('click', function () {
      var d = document.createElement('div');
      d.id = 'the-modal';
      d.setAttribute('role', 'dialog');
      d.innerHTML = '<h2 id="modal-title">Confirm the order</h2>' +
        '<input id="modal-qty" placeholder="Quantity">' +
        '<button id="modal-confirm">Confirm</button>' +
        '<button id="modal-cancel">Cancel</button>';
      document.getElementById('modal-root').appendChild(d);
    });
  </script>
</body></html>`;

const SECOND = `<!doctype html><html><body>
  <h1 id="second-title">Second page</h1>
  <button id="only-on-second">Only here</button>
  <input id="second-field" placeholder="Second field">
</body></html>`;

const server = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html' }).end((q.url || '/').startsWith('/second') ? SECOND : PAGE);
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const url = `http://127.0.0.1:${server.address().port}/`;
console.log('pagina di prova:', url);
await new Promise(() => {}); // resta in ascolto
