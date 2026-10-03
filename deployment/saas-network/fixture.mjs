import http from 'node:http';

for (const port of (process.env.FIXTURE_PORTS || '80').split(',').map(Number)) {
  http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://denied.wfm.example/' });
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
    }
    res.end('isolated-fixture');
  }).listen(port, '0.0.0.0');
}
