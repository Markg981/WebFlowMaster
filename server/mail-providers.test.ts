import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mailProviderDeps, normalizeProviderRequest, providerHeaders, snsSigningString, type ProviderDependencies } from './mail-providers';
import type { ProviderMailConfig } from '@shared/mail-settings';

const id = randomUUID();
const timestamp = () => String(Math.floor(Date.now() / 1000));
const config: ProviderMailConfig = { organizationId: 7, callbackId: randomUUID(), provider: 'sendgrid' };
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const secret = 'fixture-only-32-character-signing-secret';
const rsaKey = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDS3jOO3ov049w1
pbJ+4FJ3j28UBYzybu01tbbUYuKAJRK+LDIoTxiGXEytkwNQbNoiNi+mnLpV1/rn
YV4KxsLynCnps2g0l1vJAfQ+dbyPk7/1mKWlGaucr7xVMPHoJYFDrHlZfq3etAn2
YqXwvFwwUUpxvKK3hdcKgHE1a9rlXOXm0RxvpzPmLoYvCp/0Dz9ya6Uj/XeiROtl
Hfzl5shS1QuyIFmxVeflcJQb43HqcrTs9hu+jVebFArNI3EJ2JhPyPWDdFbk5ivm
kK937NsQ8fmnk4snWEG1XK8v3T5aPcxPqNtvhwmdG0+di9vKLka2iroW0sesHQOZ
mWbNEAojAgMBAAECggEACT3p3pIhv4WZFNTX942XWlwepIRVwsOv1nx0sJGg7GLe
Pm2AyUQmMVqsQFNC1Zc1EZjJtTCwo1Xdo58ggwe7wEGt6JXktEwJ9CEHdmasm/0A
GyB/P2GE+aS4yWG6yHo+/xtOZOi+GsD4oCQqB7IJtv2+bdu0T1IotEd1hBTfuXuo
wBaAxqElhta4P+XTkev4pqNKOK9EbU+mWqESI+kb2B9wNhnAhid9g5/2KHHCaWw7
O97uwHcoyl0QlKLMIV4bsbGUh8eb2vL1jwzXZTOr22MZUVQx1piIstbIMJ7GyabA
y13OqnW4ylrKBpCUm/UjUlX7wA9Cah2xDobOT3Gk4QKBgQD6AqByP4Ju3McgicbA
68o+YIC1ocPXVQhJCIuW0ubJC3UsHY5T92kOyaUOH/UZGrwpzcb33niZexP4/mg2
S/qQ22FTqkV5K3eEHaL9qq30HVBjZjbTKQMHzB4iVEU2BH6zZGmej43pzaf1dSMd
akRKm6FeDZ7TVCDRSyz7CLm1MwKBgQDX64Fs24KqPaO6Qqe10a0VChRzgbxk3MhT
IiBtS4sOSnBkLoYzuUUznuql00wAaWX5a9FaiJjGbTJIQrXQR9fQguDS5SStyL+v
a090t340yIcc8jte4tG1jiTwUQF2TuUdTh+YWpsag/BVIp8QvRpilnFjVyhinmKl
f059NqF3UQKBgQDR5NSpNjKeOpKe+ay4mPzBY6mLU9UkekorbpYquMNy9ECaGfI9
AlDcTmRZOHFAc1aXziAGR2t+h3scJxJ8y0sAxH2wjRoogVqku3D0gI/si5PK76yF
mT/nEvIVpiQ5For8tweJTEI7kSI6i+5AKtBMxt4yJUM7brzimbeYxhmLSwKBgQCt
QtinbnmqfC3er8/+MVOvN1hz254+XYAOXashqOXbwNXxPfgIl1m1c4cdK7Gn/uuK
Ov9So5vcVhFsNMPKb2v5cJxR/vfwz88pR3YJ1ZhbaLIrAyGrIV1gT8DKamY+9k4Z
tu/ZhJNDsq3u0wpLF0ON6uTv7yeEA05rOP3VsjndEQKBgQC98WpxqWl/K0aoy77J
Z44RDSjAxhQRCCGpQBCMwv+l/0hulLBlOk4QSg6HJxQQsd0BkEf7MYdTQHzDkEr4
T6luwIIZC9rMv76DRP73xKOgcNQcRTqcIJtUpm2Wz3l/ezcX3LcNfsu9bJ+n0QG5
U1MZKMJTBzuCMUwagE1j4BYu4Q==
-----END PRIVATE KEY-----`;
const certificate = `-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIUCzaUTbSUHu/t0Tf4SQGJkSYi5FEwDQYJKoZIhvcNAQEL
BQAwJjEkMCIGA1UEAwwbc25zLmV1LXdlc3QtMS5hbWF6b25hd3MuY29tMB4XDTI2
MTAwMzIzNTc0MFoXDTM2MDkzMDIzNTc0MFowJjEkMCIGA1UEAwwbc25zLmV1LXdl
c3QtMS5hbWF6b25hd3MuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEA0t4zjt6L9OPcNaWyfuBSd49vFAWM8m7tNbW21GLigCUSviwyKE8YhlxMrZMD
UGzaIjYvppy6Vdf652FeCsbC8pwp6bNoNJdbyQH0PnW8j5O/9ZilpRmrnK+8VTDx
6CWBQ6x5WX6t3rQJ9mKl8LxcMFFKcbyit4XXCoBxNWva5Vzl5tEcb6cz5i6GLwqf
9A8/cmulI/13okTrZR385ebIUtULsiBZsVXn5XCUG+Nx6nK07PYbvo1XmxQKzSNx
CdiYT8j1g3RW5OYr5pCvd+zbEPH5p5OLJ1hBtVyvL90+Wj3MT6jbb4cJnRtPnYvb
yi5Gtoq6FtLHrB0DmZlmzRAKIwIDAQABo1MwUTAdBgNVHQ4EFgQUuTGyRU8L3RXc
Jh09905HaS84VEkwHwYDVR0jBBgwFoAUuTGyRU8L3RXcJh09905HaS84VEkwDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAHq2WYJOE6+3cwrOTeiZE
IKxtbTO7yT4oIM2DYwp2VlOR4Rlci1DGWsEwOP4cBdg2BkZeO88Q9VKo+cHH0py3
wXQL2H83533NfvlfuWZ6gvP82sWowRTS9xwLvSEMi4SxMrBLyZWpbfYM2oB001hc
hwueakfs2r4VFSSe4O5fSBGGCGOZ98LBjNtsGVQxuwgA+/TX4wafN/rU9I4x7HvU
MOl6SJb1jc1YPnCkeKRKIA7WyKyeO1daRTEriBXN249YVD8nriYT4MYmt+9pEC09
sngzkOy75RSRBqogMevjNU9kzlirxwS0t2bMQY50iioMCy5taOuYDaSpVRbHgdAS
Xw==
-----END CERTIFICATE-----`;
const topic = 'arn:aws:sns:eu-west-1:123456789012:mail-events';
const deps: ProviderDependencies = { fetchCertificate: vi.fn(async () => certificate), confirmSubscription: vi.fn(async () => {}) };
function sg(events: unknown[], ts = timestamp()) {
  const body = Buffer.from(JSON.stringify(events, null, 2));
  return { body, headers: { 'x-twilio-email-event-webhook-timestamp': ts,
    'x-twilio-email-event-webhook-signature': sign('sha256', Buffer.concat([Buffer.from(ts), body]), ec.privateKey).toString('base64') } };
}
const sgConfig = { ...config, sendgridPublicKey: ec.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
function sns(type = 'Notification', message = JSON.stringify({ notificationType: 'Delivery', mail: { headers: [{ name: 'X-Wfm-Delivery-Id', value: id }] }, delivery: { recipients: ['ann@shop.test'] } })) {
  const data: Record<string, string> = { Type: type, MessageId: randomUUID(), TopicArn: topic, Timestamp: new Date().toISOString(), Message: message,
    SignatureVersion: '2', SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem' };
  if (type === 'SubscriptionConfirmation') Object.assign(data, { Token: 'safe-token', SubscribeURL: 'https://attacker.test/never-follow-this' });
  data.Signature = sign('RSA-SHA256', Buffer.from(snsSigningString(data)), rsaKey).toString('base64');
  return data;
}
const sesConfig = { ...config, provider: 'ses' as const, sesTopicArn: topic };
beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('native email provider protocols', () => {
  it('adds provider-native SMTP correlation arguments', () => {
    expect(JSON.parse(providerHeaders(config, id)['X-SMTPAPI'])).toEqual({ unique_args: { wfm_delivery_id: id } });
    expect(JSON.parse(providerHeaders({ ...config, provider: 'mailgun' }, id)['X-Mailgun-Variables'])).toEqual({ wfm_delivery_id: id });
    expect(providerHeaders(sesConfig, id)['X-Wfm-Delivery-Id']).toBe(id);
  });
  it('verifies ECDSA over exact raw bytes and normalizes native outcomes/event IDs', async () => {
    const request = sg(['delivered', 'deferred', 'bounce'].map((event, i) => ({ event, sg_event_id: `native/id.${i}`, wfm_delivery_id: id, email: 'ann@shop.test', type: 'bounce' })));
    const result = await normalizeProviderRequest(sgConfig, request.body, request.headers, deps);
    expect(result.events.map(e => e.event.status)).toEqual(['delivered', 'soft_bounce', 'hard_bounce']);
    expect(result.events[0]).toMatchObject({ recipient: 'ann@shop.test', event: { messageId: id, eventId: expect.stringMatching(/^sendgrid:[a-f0-9]{64}$/) } });
    await expect(normalizeProviderRequest(sgConfig, Buffer.from(JSON.stringify(JSON.parse(request.body.toString()))), request.headers, deps)).rejects.toMatchObject({ status: 401 });
    const stale = sg([], String(Number(timestamp()) - 301));
    await expect(normalizeProviderRequest(sgConfig, stale.body, stale.headers, deps)).rejects.toMatchObject({ status: 401 });
  });
  it('acknowledges irrelevant events but rejects malformed supported entries before partial persistence', async () => {
    const request = sg([{ event: 'open' }, { event: 'delivered', sg_event_id: '1', wfm_delivery_id: id, email: 'ann@shop.test' }, { event: 'bounce', wfm_delivery_id: id }]);
    await expect(normalizeProviderRequest(sgConfig, request.body, request.headers, deps)).rejects.toMatchObject({ status: 400 });
    const irrelevant = sg([{ event: 'open' }]);
    expect((await normalizeProviderRequest(sgConfig, irrelevant.body, irrelevant.headers, deps)).events).toEqual([]);
    const big = sg(Array.from({ length: 101 }, () => ({ event: 'open' })));
    await expect(normalizeProviderRequest(sgConfig, big.body, big.headers, deps)).rejects.toMatchObject({ status: 400 });
  });
  it('verifies Mailgun native HMAC and failure severity', async () => {
    const ts = timestamp(), token = 'native-token';
    const payload = { signature: { timestamp: ts, token, signature: createHmac('sha256', secret).update(ts + token).digest('hex') },
      'event-data': { event: 'failed', severity: 'temporary', id: 'native.id', recipient: 'ann@shop.test', 'user-variables': { wfm_delivery_id: id } } };
    const cfg = { ...config, provider: 'mailgun' as const, signingSecret: secret };
    expect((await normalizeProviderRequest(cfg, Buffer.from(JSON.stringify(payload)), {}, deps)).events[0].event.status).toBe('soft_bounce');
    payload['event-data'].severity = 'permanent';
    expect((await normalizeProviderRequest(cfg, Buffer.from(JSON.stringify(payload)), {}, deps)).events[0].event.status).toBe('hard_bounce');
    payload.signature.token = 'forged';
    await expect(normalizeProviderRequest(cfg, Buffer.from(JSON.stringify(payload)), {}, deps)).rejects.toMatchObject({ status: 401 });
  });
  it('verifies SES topic/certificate/signature before following constructed confirmation', async () => {
    const payload = sns();
    expect((await normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(payload)), {}, deps)).events[0]).toMatchObject({ recipient: 'ann@shop.test', event: { messageId: id, status: 'delivered' } });
    const confirm = sns('SubscriptionConfirmation');
    expect((await normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(confirm)), {}, deps)).events).toEqual([]);
    expect(deps.confirmSubscription).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/sns\.eu-west-1\.amazonaws\.com\/\?Action=ConfirmSubscription&/));
    vi.clearAllMocks(); confirm.Signature = Buffer.from('forged').toString('base64');
    await expect(normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(confirm)), {}, deps)).rejects.toMatchObject({ status: 401 });
    expect(deps.confirmSubscription).not.toHaveBeenCalled();
  });
  it.each(['http://sns.eu-west-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem',
    'https://sns.eu-west-1.amazonaws.com.attacker.test/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem',
    'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem',
    'https://sns.eu-west-1.amazonaws.com:8443/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem',
    'https://sns.eu-west-1.amazonaws.com/evil.pem',
    'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem?redirect=1'])('rejects unsafe SNS certificate URLs without fetching: %s', async url => {
    const payload = { ...sns(), SigningCertURL: url };
    await expect(normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(payload)), {}, deps)).rejects.toMatchObject({ status: 401 });
    expect(deps.fetchCertificate).not.toHaveBeenCalled();
  });
  it('rejects foreign topics and unknown bounce classifications', async () => {
    const foreign = { ...sns(), TopicArn: topic + '-foreign' };
    await expect(normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(foreign)), {}, deps)).rejects.toMatchObject({ status: 401 });
    const invalid = sns('Notification', JSON.stringify({ notificationType: 'Bounce', mail: { headers: [{ name: 'X-Wfm-Delivery-Id', value: id }] }, bounce: { bounceType: 'Undetermined', bouncedRecipients: [{ emailAddress: 'ann@shop.test' }] } }));
    expect((await normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(invalid)), {}, deps)).events).toEqual([]);
  });
  it('accepts SNS retries within its HTTP retry window and rejects stale/future signed timestamps', async () => {
    const payload = sns();
    payload.Timestamp = new Date(Date.now() - 30 * 60000).toISOString();
    payload.Signature = sign('RSA-SHA256', Buffer.from(snsSigningString(payload)), rsaKey).toString('base64');
    expect((await normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(payload)), {}, deps)).events).toHaveLength(1);
    for (const time of [Date.now() - 66 * 60000, Date.now() + 6 * 60000]) {
      payload.Timestamp = new Date(time).toISOString();
      payload.Signature = sign('RSA-SHA256', Buffer.from(snsSigningString(payload)), rsaKey).toString('base64');
      await expect(normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(payload)), {}, deps)).rejects.toMatchObject({ status: 401 });
    }
  });
  it('uses no-redirect bounded certificate requests and caches valid certificates', async () => {
    const fetchMock = vi.fn(async () => new Response(certificate));
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-11111111111111111111111111111111.pem';
    await expect(mailProviderDeps.fetchCertificate(url)).resolves.toBe(certificate);
    await expect(mailProviderDeps.fetchCertificate(url)).resolves.toBe(certificate);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(url, { redirect: 'error', signal: expect.any(AbortSignal) });
    const hugeUrl = url.replace(/1/g, '2');
    fetchMock.mockImplementationOnce(async () => new Response('x'.repeat(16385)));
    await expect(mailProviderDeps.fetchCertificate(hugeUrl)).rejects.toThrow('SNS response too large');
    fetchMock.mockImplementationOnce(async () => new Response('x', { headers: { 'content-length': '17000' } }));
    await expect(mailProviderDeps.fetchCertificate(hugeUrl)).rejects.toThrow('SNS request failed');
    fetchMock.mockImplementationOnce(async () => new Response('redirect', { status: 302 }));
    await expect(mailProviderDeps.fetchCertificate(hugeUrl)).rejects.toThrow('SNS request failed');
  });
  it('times out certificate fetches and retries recoverable certificate/confirmation errors', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const fetchPromise = mailProviderDeps.fetchCertificate('https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-33333333333333333333333333333333.pem');
    const assertion = expect(fetchPromise).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(5000); await assertion;
    vi.useRealTimers();
    const unavailable: ProviderDependencies = { fetchCertificate: vi.fn(async () => { throw new Error('private upstream error'); }), confirmSubscription: vi.fn(async () => {}) };
    await expect(normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(sns())), {}, unavailable)).rejects.toMatchObject({ status: 503, message: 'Could not retrieve SNS certificate' });
    unavailable.fetchCertificate = async () => certificate;
    unavailable.confirmSubscription = async () => { throw new Error('private confirmation error'); };
    await expect(normalizeProviderRequest(sesConfig, Buffer.from(JSON.stringify(sns('SubscriptionConfirmation'))), {}, unavailable)).rejects.toMatchObject({ status: 503, message: 'Could not confirm SNS subscription' });
  });
});
