import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

test('updated mail runtime composes UTF-8 messages and in-memory attachments', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const result = await transport.sendMail({
    from: 'WebFlowMaster <sender@example.test>',
    to: 'Colleague <recipient@example.test>',
    subject: 'Collaudo – release',
    text: 'Risultato esecuzione',
    html: '<p>Risultato esecuzione</p>',
    attachments: [{ filename: 'result.txt', content: 'passed' }],
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  assert.equal(result.envelope.from, 'sender@example.test');
  assert.deepEqual(result.envelope.to, ['recipient@example.test']);
  const message = result.message.toString();
  assert.match(message, /multipart\/mixed/);
  assert.match(message, /filename=result\.txt/);
  assert.match(message, /Content-Type: text\/html/);
  transport.close();
});
