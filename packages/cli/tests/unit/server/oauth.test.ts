import { createHash, createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  safeStringEqual,
  makeAuthCode,
  verifyAuthCode,
  handleOAuthRequest,
  type OAuthConfig,
} from '../../../src/server/oauth.js';

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('safeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeStringEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(safeStringEqual('hello', 'world')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    expect(() => safeStringEqual('short', 'much-longer-string')).not.toThrow();
    expect(safeStringEqual('short', 'much-longer-string')).toBe(false);
  });
});

describe('makeAuthCode / verifyAuthCode', () => {
  const KEY = 'test-signing-key';

  it('roundtrips a payload', () => {
    const payload = { cid: 'client1', rdi: 'https://example.com/cb', exp: 9999999999999 };
    const code = makeAuthCode(payload, KEY);
    const decoded = verifyAuthCode(code, KEY);
    expect(decoded).toMatchObject(payload);
  });

  it('returns null when signature is tampered', () => {
    const code = makeAuthCode({ foo: 'bar' }, KEY);
    const tampered = code.slice(0, -4) + 'XXXX';
    expect(verifyAuthCode(tampered, KEY)).toBeNull();
  });

  it('returns null when there is no dot separator', () => {
    expect(verifyAuthCode('nodothere', KEY)).toBeNull();
  });

  it('returns null when body is invalid base64url JSON', () => {
    const invalidBody = Buffer.from('not-json!!!').toString('base64url');
    const sig = createHmac('sha256', KEY).update(invalidBody).digest('base64url');
    expect(verifyAuthCode(`${invalidBody}.${sig}`, KEY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Endpoint handler helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG: OAuthConfig = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  expectedToken: 'bearer-token',
  publicUrlOverride: undefined,
  port: 3000,
  codeSigningKey: 'signing-key',
};

function makeReq(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body = '',
): IncomingMessage {
  const req = {
    method,
    url,
    headers,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(body);
      if (event === 'end') cb();
    }),
  } as unknown as IncomingMessage;
  return req;
}

function makeRes() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  return res;
}

function getRedirectTarget(res: ReturnType<typeof makeRes>): URL {
  const location = (res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![1]?.Location as string;
  return new URL(location);
}

// ---------------------------------------------------------------------------
// Discovery endpoint
// ---------------------------------------------------------------------------

describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns authorization_endpoint', async () => {
    const req = makeReq('GET', '/.well-known/oauth-authorization-server');
    const res = makeRes();
    await handleOAuthRequest(req, res, '/.well-known/oauth-authorization-server', BASE_CONFIG);
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(body.authorization_endpoint).toContain('/oauth/authorize');
  });

  it('returns code_challenge_methods_supported with S256 and plain', async () => {
    const req = makeReq('GET', '/.well-known/oauth-authorization-server');
    const res = makeRes();
    await handleOAuthRequest(req, res, '/.well-known/oauth-authorization-server', BASE_CONFIG);
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(body.code_challenge_methods_supported).toEqual(['S256', 'plain']);
  });
});

// ---------------------------------------------------------------------------
// /oauth/authorize
// ---------------------------------------------------------------------------

describe('GET /oauth/authorize', () => {
  it('returns 302 with code and state for a valid S256 request', async () => {
    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = createHash('sha256').update(codeVerifier, 'utf-8').digest('base64url');
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: BASE_CONFIG.clientId,
      redirect_uri: 'https://example.com/cb',
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const req = makeReq('GET', `/oauth/authorize?${qs}`);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/authorize', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(302);
    const target = getRedirectTarget(res);
    expect(target.searchParams.get('code')).toBeTruthy();
    expect(target.searchParams.get('state')).toBe('xyz');
  });

  it('returns 400 directly (no redirect) for unknown client_id', async () => {
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: 'wrong-client',
      redirect_uri: 'https://example.com/cb',
    });
    const req = makeReq('GET', `/oauth/authorize?${qs}`);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/authorize', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(400);
    const body = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(body.error).toBe('invalid_client');
  });

  it('returns 400 directly for missing redirect_uri', async () => {
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: BASE_CONFIG.clientId,
    });
    const req = makeReq('GET', `/oauth/authorize?${qs}`);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/authorize', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(400);
  });

  it('redirects with unsupported_response_type for response_type=token', async () => {
    const qs = new URLSearchParams({
      response_type: 'token',
      client_id: BASE_CONFIG.clientId,
      redirect_uri: 'https://example.com/cb',
    });
    const req = makeReq('GET', `/oauth/authorize?${qs}`);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/authorize', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(302);
    const target = getRedirectTarget(res);
    expect(target.searchParams.get('error')).toBe('unsupported_response_type');
  });
});

// ---------------------------------------------------------------------------
// /oauth/token — authorization_code grant
// ---------------------------------------------------------------------------

async function mintCode(overrides: Record<string, unknown> = {}): Promise<string> {
  const { makeAuthCode: mint } = await import('../../../src/server/oauth.js');
  return mint(
    {
      cid: BASE_CONFIG.clientId,
      rdi: 'https://example.com/cb',
      cch: '',
      ccm: 'plain',
      sco: 'mcp',
      exp: Date.now() + 600_000,
      ...overrides,
    },
    BASE_CONFIG.codeSigningKey,
  );
}

describe('POST /oauth/token — authorization_code', () => {
  it('issues a token for a valid S256 PKCE exchange', async () => {
    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = createHash('sha256').update(codeVerifier, 'utf-8').digest('base64url');
    const code = await mintCode({ cch: challenge, ccm: 'S256' });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://example.com/cb',
      client_id: BASE_CONFIG.clientId,
      code_verifier: codeVerifier,
    }).toString();
    const req = makeReq('POST', '/oauth/token', { 'content-type': 'application/x-www-form-urlencoded' }, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(200);
    const resp = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(resp.access_token).toBe(BASE_CONFIG.expectedToken);
  });

  it('returns 400 invalid_grant for an expired code', async () => {
    const code = await mintCode({ exp: Date.now() - 1 });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://example.com/cb',
      client_id: BASE_CONFIG.clientId,
      client_secret: BASE_CONFIG.clientSecret,
    }).toString();
    const req = makeReq('POST', '/oauth/token', {}, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(400);
    const resp = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(resp.error).toBe('invalid_grant');
  });

  it('returns 400 for wrong code_verifier', async () => {
    const codeVerifier = 'correct-verifier-string-of-sufficient-length-for-pkce';
    const challenge = createHash('sha256').update(codeVerifier, 'utf-8').digest('base64url');
    const code = await mintCode({ cch: challenge, ccm: 'S256' });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://example.com/cb',
      client_id: BASE_CONFIG.clientId,
      code_verifier: 'wrong-verifier',
    }).toString();
    const req = makeReq('POST', '/oauth/token', {}, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(400);
    const resp = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(resp.error).toBe('invalid_grant');
  });

  it('returns 400 for redirect_uri mismatch', async () => {
    const code = await mintCode({ cch: '', ccm: 'plain' });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://wrong.example.com/cb',
      client_id: BASE_CONFIG.clientId,
      client_secret: BASE_CONFIG.clientSecret,
    }).toString();
    const req = makeReq('POST', '/oauth/token', {}, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(400);
    const resp = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(resp.error).toBe('invalid_grant');
  });

  it('returns 401 when no PKCE challenge and no client_secret', async () => {
    const code = await mintCode({ cch: '', ccm: 'plain' });
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://example.com/cb',
      client_id: BASE_CONFIG.clientId,
    }).toString();
    const req = makeReq('POST', '/oauth/token', {}, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /oauth/token — client_credentials (regression)
// ---------------------------------------------------------------------------

describe('POST /oauth/token — client_credentials', () => {
  it('still issues a token with valid credentials', async () => {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: BASE_CONFIG.clientId,
      client_secret: BASE_CONFIG.clientSecret,
    }).toString();
    const req = makeReq('POST', '/oauth/token', {}, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(200);
    const resp = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(resp.access_token).toBe(BASE_CONFIG.expectedToken);
  });
});

// ---------------------------------------------------------------------------
// /oauth/token — unknown grant_type
// ---------------------------------------------------------------------------

describe('POST /oauth/token — unknown grant_type', () => {
  it('returns 400 unsupported_grant_type', async () => {
    const body = new URLSearchParams({ grant_type: 'implicit' }).toString();
    const req = makeReq('POST', '/oauth/token', {}, body);
    const res = makeRes();
    await handleOAuthRequest(req, res, '/oauth/token', BASE_CONFIG);
    expect((res.writeHead as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(400);
    const resp = JSON.parse((res.end as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string);
    expect(resp.error).toBe('unsupported_grant_type');
  });
});
