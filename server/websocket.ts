import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { QueueEvents } from 'bullmq';
import { connection } from './redis';
import { TEST_EXECUTION_QUEUE_NAME } from './queue';
import loggerPromise from './logger';

export async function setupWebSockets(server: Server) {
  const logger = await loggerPromise;
  const wss = new WebSocketServer({ server, path: '/ws' });

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    logger.info('New WebSocket client connected for live logs');
    clients.add(ws);

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  const queueEvents = new QueueEvents(TEST_EXECUTION_QUEUE_NAME, { connection });

  queueEvents.on('active', ({ jobId }) => {
    broadcast({ type: 'job-active', jobId, log: `[SYSTEM] Job ${jobId} is active and running.` });
  });

  queueEvents.on('completed', ({ jobId }) => {
    broadcast({ type: 'job-completed', jobId, log: `[SYSTEM] Job ${jobId} PASSED successfully.` });
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    broadcast({ type: 'job-failed', jobId, log: `[SYSTEM] Job ${jobId} FAILED: ${failedReason}` });
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    if (typeof data === 'object' && data !== null && 'log' in data) {
      broadcast({ type: 'job-progress', jobId, log: data.log });
    }
  });

  function broadcast(message: any) {
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  logger.info('WebSocket server initialized and listening to BullMQ events');
}
