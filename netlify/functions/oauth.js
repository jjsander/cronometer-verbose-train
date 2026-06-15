/**
 * OAuth 2.0 endpoints for Claude.ai custom connector compatibility.
 *
 * Claude.ai requires OAuth 2.0 client credentials flow to connect to custom MCP servers.
 * We implement a thin OAuth wrapper around our static MCP_AUTH_TOKEN — no real user
 * auth is needed since this is a personal single-user server.
 *
 * Endpoints served (via netlify.toml redirects):
 *   GET  /.well-known/oauth-protected-resource     — resource metadata
 *   GET  /.well-known/oauth-authorization-server   — authorization server metadata
 *   POST /oauth/token                              — issues access token
 *
 * Required env vars:
 *   MCP_AUTH_TOKEN        — the static Bearer token used to authenticate MCP calls
 *   OAUTH_CLIENT_ID       — client ID you register in Claude.ai
 *   OAUTH_CLIENT_SECRET   — client secret you register in Claude.ai
 */

const BASE_URL = 'https://cronometer-verbose-train.netlify.app';

export default async function handler(req, context) {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── CORS preflight ──────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // ── OAuth Protected Resource Metadata ──────────────────────────────────────
  // RFC 9728 — tells Claude.ai where to find the auth server
  if (path === '/.well-known/oauth-protected-resource') {
    return json({
      resource: `${BASE_URL}/mcp`,
      authorization_servers: [BASE_URL],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:tools'],
    });
  }

  // ── OAuth Authorization Server Metadata ────────────────────────────────────
  // RFC 8414 — describes what OAuth flows we support
  if (path === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: BASE_URL,
      token_endpoint: `${BASE_URL}/oauth/token`,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      grant_types_supported: ['client_credentials'],
      scopes_supported: ['mcp:tools'],
      response_types_supported: ['token'],
    });
  }

  // ── Token Endpoint ──────────────────────────────────────────────────────────
  // Issues an access token if client credentials are valid
  if (path === '/oauth/token' && req.method === 'POST') {
    let clientId, clientSecret, grantType;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      clientId     = params.get('client_id');
      clientSecret = params.get('client_secret');
      grantType    = params.get('grant_type');
    } else if (contentType.includes('application/json')) {
      const body = await req.json();
      clientId     = body.client_id;
      clientSecret = body.client_secret;
      grantType    = body.grant_type;
    } else {
      // Also support HTTP Basic auth for client credentials
      const authHeader = req.headers.get('authorization') || '';
      if (authHeader.startsWith('Basic ')) {
        const decoded = atob(authHeader.slice(6));
        [clientId, clientSecret] = decoded.split(':');
      }
      const text = await req.text();
      const params = new URLSearchParams(text);
      grantType = params.get('grant_type');
    }

    if (grantType !== 'client_credentials') {
      return json({ error: 'unsupported_grant_type' }, 400);
    }

    const expectedClientId     = process.env.OAUTH_CLIENT_ID;
    const expectedClientSecret = process.env.OAUTH_CLIENT_SECRET;

    if (clientId !== expectedClientId || clientSecret !== expectedClientSecret) {
      return json({ error: 'invalid_client' }, 401);
    }

    // Issue our static MCP_AUTH_TOKEN as the access token.
    // Claude will then pass it as "Authorization: Bearer <token>" on MCP calls.
    return json({
      access_token: process.env.MCP_AUTH_TOKEN,
      token_type: 'Bearer',
      expires_in: 7776000, // 90 days — effectively static
      scope: 'mcp:tools',
    });
  }

  return new Response('Not Found', { status: 404 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export const config = {
  path: [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
    '/oauth/token',
  ],
};
