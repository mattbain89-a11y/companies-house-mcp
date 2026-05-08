import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  expectedToken: string;
  publicUrlOverride: string | undefined;
  port: number;
  codeSigningKey: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Constant-time string comparison. Hashes inputs to equal length first when
 *  lengths differ, so timing is independent of where strings diverge. */
export function safeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) {
    const ha = createHash('sha256').update(ba).digest();
    const hb = createHash('sha256').update(bb).digest();
    timingSafeEqual(ha, hb);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Mint a stateless HMAC-signed authorization code.
 *  Format: base64url(JSON(payload)).base64url(HMAC-SHA256(body))
 *  No server-side store needed — the signature is enough to trust the payload. */
export function makeAuthCode(
  payload: Record<string, unknown>,
  signingKey: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = createHmac('sha256', signingKey).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify an HMAC-signed auth code. Returns the decoded payload or null. */
export function verifyAuthCode(
  code: string,
  signingKey: string,
): Record<string, unknown> | null {
  const dotIdx = code.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const body = code.slice(0, dotIdx);
  const sig = code.slice(dotIdx + 1);
  const expected = createHmac('sha256', signingKey).update(body).digest('base64url');
  if (!safeStringEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: unknown) => { body += String(chunk); });
    req.on('end', () => resolve(body));
    req.on('error', (err: unknown) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle OAuth discovery, authorization, and token endpoints.
 * Returns true if the request was handled (caller should return), false otherwise.
 */
export async function handleOAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  config: OAuthConfig,
): Promise<boolean> {

  // ---- Discovery metadata ------------------------------------------------
  if (pathname === '/.well-known/oauth-authorization-server') {
    const proto =
      (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
    const host =
      (req.headers.host as string | undefined) ?? `localhost:${config.port}`;
    const issuer = config.publicUrlOverride || `${proto}://${host}`;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'client_credentials'],
        code_challenge_methods_supported: ['S256', 'plain'],
        token_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post',
          'none',
        ],
        scopes_supported: ['mcp'],
      }),
    );
    return true;
  }

  // ---- Authorization endpoint --------------------------------------------
  if (pathname === '/oauth/authorize') {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end('Method Not Allowed');
      return true;
    }

    // Parse the URL to get query params. The caller passes pathname but we
    // need the full URL to read searchParams. Reconstruct from the raw URL.
    const rawUrl = (req as IncomingMessage & { url?: string }).url ?? '/oauth/authorize';
    const fullUrl = new URL(rawUrl, `http://localhost:${config.port}`);
    const q = fullUrl.searchParams;

    const responseType = q.get('response_type');
    const reqClientId = q.get('client_id');
    const redirectUri = q.get('redirect_uri');
    const state = q.get('state') ?? '';
    const codeChallenge = q.get('code_challenge') ?? '';
    const codeChallengeMethod = q.get('code_challenge_method') ?? 'plain';
    const scope = q.get('scope') ?? '';

    // Redirect errors back to the client (RFC 6749 §4.1.2.1).
    // Exception: unknown client_id or malformed redirect_uri must NOT
    // redirect, to prevent open-redirect attacks.
    const redirectError = (errorCode: string, description: string) => {
      if (!redirectUri) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorCode, error_description: description }));
        return;
      }
      let target: URL;
      try {
        target = new URL(redirectUri);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Malformed redirect_uri' }));
        return;
      }
      target.searchParams.set('error', errorCode);
      target.searchParams.set('error_description', description);
      if (state) target.searchParams.set('state', state);
      res.writeHead(302, { Location: target.toString(), 'Access-Control-Allow-Origin': '*' });
      res.end();
    };

    if (!reqClientId || !safeStringEqual(reqClientId, config.clientId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Unknown client_id' }));
      return true;
    }
    if (!redirectUri) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Missing redirect_uri' }));
      return true;
    }
    try { new URL(redirectUri); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Malformed redirect_uri' }));
      return true;
    }
    if (responseType !== 'code') {
      redirectError('unsupported_response_type', 'Only response_type=code is supported');
      return true;
    }
    if (codeChallengeMethod !== 'S256' && codeChallengeMethod !== 'plain') {
      redirectError('invalid_request', 'Unsupported code_challenge_method');
      return true;
    }

    // Single-user server: correct client_id = implicit approval.
    const code = makeAuthCode(
      {
        cid: reqClientId,
        rdi: redirectUri,
        cch: codeChallenge,
        ccm: codeChallengeMethod,
        sco: scope,
        exp: Date.now() + 10 * 60 * 1000,
      },
      config.codeSigningKey,
    );

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    res.writeHead(302, { Location: target.toString(), 'Access-Control-Allow-Origin': '*' });
    res.end();
    return true;
  }

  // ---- Token endpoint ----------------------------------------------------
  if (pathname === '/oauth/token') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Only POST is supported' }));
      return true;
    }

    let bodyText = '';
    try {
      bodyText = await readRequestBody(req);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request', error_description: `Could not read body: ${(err as Error).message}` }));
      return true;
    }

    const params = new URLSearchParams(bodyText);

    // Client credentials may arrive via HTTP Basic auth (RFC 6749 §2.3.1) or body.
    let reqClientId: string | undefined;
    let reqClientSecret: string | undefined;

    const authHeader = (req.headers.authorization as string | undefined) ?? '';
    const basicMatch = authHeader.match(/^Basic\s+(.+)$/i);
    if (basicMatch && basicMatch[1]) {
      try {
        const decoded = Buffer.from(basicMatch[1], 'base64').toString('utf-8');
        const colonIdx = decoded.indexOf(':');
        if (colonIdx >= 0) {
          reqClientId = decodeURIComponent(decoded.slice(0, colonIdx));
          reqClientSecret = decodeURIComponent(decoded.slice(colonIdx + 1));
        }
      } catch {
        /* fall through to body credentials */
      }
    }
    if (!reqClientId) reqClientId = params.get('client_id') ?? undefined;
    if (!reqClientSecret) reqClientSecret = params.get('client_secret') ?? undefined;

    const grantType = params.get('grant_type');

    const issueToken = () => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ access_token: config.expectedToken, token_type: 'Bearer', expires_in: 3600 }));
    };

    // ---- client_credentials grant ----------------------------------------
    if (grantType === 'client_credentials') {
      if (
        !reqClientId ||
        !reqClientSecret ||
        !safeStringEqual(reqClientId, config.clientId) ||
        !safeStringEqual(reqClientSecret, config.clientSecret)
      ) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic' });
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Unknown client_id or client_secret' }));
        return true;
      }
      issueToken();
      return true;
    }

    // ---- authorization_code grant ----------------------------------------
    if (grantType === 'authorization_code') {
      const code = params.get('code') ?? '';
      const codeVerifier = params.get('code_verifier') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Missing code' }));
        return true;
      }

      const payload = verifyAuthCode(code, config.codeSigningKey);
      if (!payload) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid authorization code' }));
        return true;
      }

      if (Date.now() > (typeof payload.exp === 'number' ? payload.exp : 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Authorization code expired' }));
        return true;
      }

      const expectedClientId = String(payload.cid ?? '');
      if (
        !reqClientId ||
        !safeStringEqual(reqClientId, expectedClientId) ||
        !safeStringEqual(expectedClientId, config.clientId)
      ) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic' });
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'client_id mismatch' }));
        return true;
      }

      // Confidential clients may present their secret; public clients use PKCE only.
      if (reqClientSecret) {
        if (!safeStringEqual(reqClientSecret, config.clientSecret)) {
          res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic' });
          res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Bad client_secret' }));
          return true;
        }
      }

      if (!redirectUri || !safeStringEqual(redirectUri, String(payload.rdi ?? ''))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }));
        return true;
      }

      const challenge = String(payload.cch ?? '');
      const challengeMethod = String(payload.ccm ?? 'plain');

      if (challenge) {
        if (!codeVerifier) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Missing code_verifier' }));
          return true;
        }
        const derived =
          challengeMethod === 'S256'
            ? createHash('sha256').update(codeVerifier, 'utf-8').digest('base64url')
            : codeVerifier;
        if (!safeStringEqual(derived, challenge)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE verification failed' }));
          return true;
        }
      } else if (!reqClientSecret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_client', error_description: 'Public clients must use PKCE; confidential clients must present client_secret' }));
        return true;
      }

      issueToken();
      return true;
    }

    // ---- unknown grant ----------------------------------------------------
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unsupported_grant_type', error_description: `Grant type '${grantType ?? ''}' is not supported` }));
    return true;
  }

  return false;
}
