import { createServer as httpServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { privilegedDb } from './db';
import { mailSettings } from '@shared/mail-settings';
import { createTestOrganization } from './tests/factories';
import { mailerDeps, sendMail, smtpTransportOptions } from './mailer';

afterEach(() => { delete process.env.WFM_EGRESS_PROXY; mailerDeps.transport = undefined; });
describe('SMTP mandatory egress proxy', () => {
  it('preserves inherited SMTP URL requirements and authorization options', () => {
    const options = smtpTransportOptions({ configured: true, inherited: true, smtpUrl: 'smtp://relay.example.com:587?requireTLS=true&authMethod=LOGIN&name=mail.example.com&tls.servername=relay.example.com' }, {});
    expect(options).toMatchObject({ requireTLS: true, authMethod: 'LOGIN', name: 'mail.example.com', tls: { servername: 'relay.example.com' } });
  });
  it('sends CONNECT through the proxy and never falls back to a reachable SMTP target after refusal', async () => {
    let directConnections = 0; const connects: string[] = [];
    const target = tcpServer(socket => { directConnections++; socket.end('550 Direct access forbidden\r\n'); });
    const proxy = httpServer(); proxy.on('connect', (req, socket) => { connects.push(req.url!); socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    try {
      const targetPort = (target.address() as AddressInfo).port;
      process.env.WFM_EGRESS_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
      const org = await createTestOrganization();
      await privilegedDb.insert(mailSettings).values({ organizationId: org, smtpMode: 'custom', smtpHost: '127.0.0.1', smtpPort: targetPort, smtpSecure: 0, fromAddress: 'sender@example.com' });
      const result = await sendMail({ organizationId: org, to: 'recipient@example.com', subject: 'Proxy fixture', text: 'Proxy fixture' });
      expect(result.sent).toBe(false); expect(connects).toEqual([`127.0.0.1:${targetPort}`]); expect(directConnections).toBe(0);
      expect(result.error).not.toContain(process.env.WFM_EGRESS_PROXY);
    } finally {
      await new Promise<void>(resolve => proxy.close(() => resolve()));
      await new Promise<void>(resolve => target.close(() => resolve()));
    }
  });
});
