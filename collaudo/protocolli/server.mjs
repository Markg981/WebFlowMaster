// Private fixtures for AGT-06/07/09/10. No ports are published to the host.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as loader from '@grpc/proto-loader';

const definition = loader.loadSync(fileURLToPath(new URL('./echo.proto', import.meta.url)));
const rpc = new grpc.Server();
rpc.addService(definition['collaudo.Echo'], {
  Say(call, callback) {
    const metadata = new grpc.Metadata();
    metadata.set('x-collaudo', 'private');
    call.sendMetadata(metadata);
    callback(null, call.request);
  },
  Wait() {}, // Deliberately waits for the client's deadline.
});
await new Promise((resolve, reject) => rpc.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), error => error ? reject(error) : resolve()));
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') return res.writeHead(200).end('ok');
  if (req.url !== '/token' || req.method !== 'POST') return res.writeHead(404).end();
  if (req.headers.authorization !== `Basic ${Buffer.from('collaudo:fixture-secret').toString('base64')}`) return res.writeHead(401).end();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ access_token: 'private-fixture-token', token_type: 'Bearer', expires_in: 60 }));
});
const ws = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/echo' || req.headers.authorization !== 'Bearer private-fixture-token') {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return;
  }
  ws.handleUpgrade(req, socket, head, client => ws.emit('connection', client));
});
ws.on('connection', socket => socket.on('message', data => socket.send(data)));
httpServer.listen(8080, '0.0.0.0', () => console.log('Private gRPC, WebSocket and OAuth fixtures ready'));
process.on('SIGTERM', () => {
  rpc.forceShutdown();
  for (const socket of ws.clients) socket.terminate();
  ws.close();
  httpServer.close();
});
