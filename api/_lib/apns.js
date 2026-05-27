// Self-hosted Apple Push (APNs) sender — no third party. Builds an ES256 JWT
// from your APNs auth key (.p8) and delivers over HTTP/2 to Apple directly.
// Env vars (set on Vercel):
//   APNS_KEY_ID       the 10-char Key ID of the .p8 key
//   APNS_TEAM_ID      your Apple Team ID (S5LPJX5N97)
//   APNS_BUNDLE_ID    the app bundle id (io.andrewpeterson.myworld)
//   APNS_PRIVATE_KEY  the full text of the .p8 file (BEGIN/END PRIVATE KEY)
//   APNS_HOST         optional override (sandbox: https://api.sandbox.push.apple.com)
import http2 from 'node:http2';
import crypto from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function apnsConfigured() {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY && process.env.APNS_BUNDLE_ID);
}

// Provider tokens are valid up to an hour; cache and refresh well before that.
let _tok = null, _tokAt = 0;
function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && (now - _tokAt) < 3000) return _tok;
  const keyId = process.env.APNS_KEY_ID, teamId = process.env.APNS_TEAM_ID;
  const keyPem = (process.env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!keyId || !teamId || !keyPem) throw new Error('APNs env not configured');
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = b64url(JSON.stringify({ iss: teamId, iat: now }));
  const signer = crypto.createSign('SHA256');
  signer.update(header + '.' + payload); signer.end();
  const sig = signer.sign({ key: keyPem, dsaEncoding: 'ieee-p1363' });   // ES256 raw r||s
  _tok = header + '.' + payload + '.' + b64url(sig); _tokAt = now;
  return _tok;
}

// Send one alert to one device token. Resolves { ok, status, body }.
export function sendPush(deviceToken, { title, body, data } = {}) {
  return new Promise((resolve) => {
    let client;
    try {
      const host = process.env.APNS_HOST || 'https://api.push.apple.com';
      const jwt = providerToken();
      client = http2.connect(host);
      client.on('error', (e) => { resolve({ ok: false, error: String(e.message || e) }); try { client.close(); } catch (_) {} });
      const req = client.request({
        ':method': 'POST', ':path': '/3/device/' + deviceToken,
        authorization: 'bearer ' + jwt, 'apns-topic': process.env.APNS_BUNDLE_ID,
        'apns-push-type': 'alert', 'content-type': 'application/json',
      });
      let status = 0, chunks = '';
      req.on('response', (h) => { status = h[':status']; });
      req.setEncoding('utf8');
      req.on('data', (d) => { chunks += d; });
      req.on('end', () => { try { client.close(); } catch (_) {} resolve({ ok: status === 200, status, body: chunks }); });
      req.on('error', (e) => { resolve({ ok: false, error: String(e.message || e) }); try { client.close(); } catch (_) {} });
      req.end(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...(data || {}) }));
    } catch (e) {
      resolve({ ok: false, error: String(e.message || e) });
      if (client) { try { client.close(); } catch (_) {} }
    }
  });
}

export async function sendToTokens(tokens, note) {
  const results = [];
  for (const t of tokens) results.push({ token: t, ...(await sendPush(t, note)) });
  return results;
}
