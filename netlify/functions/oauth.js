/**
 * OAuth 2.0 endpoints for Claude.ai custom connector compatibility.
 *
 * Claude.ai uses PKCE authorization code flow. Since this is a personal
 * single-user server, /authorize auto-approves and immediately redirects
 * back to Claude.ai with an auth code. No login page needed.
 *
 * Endpoints:
 *   GET  /.well-known/oauth-protected-resource     — resource metadata
 *   GET  /.well-known/oauth-authorization-server   — server metadata
 *   GET  /authorize                                — auto-approves, redirects back
 *   POST /oauth/token                              — exchanges code for token
 *
 * Env vars:
 *   MCP_AUTH_TOKEN        — static Bearer token for MCP calls
 *   OAUTH_CLIENT_ID       — client ID registered in Claude.ai
 */

const BASE_URL = 'https://cronometer-verbose-train.netlify.app';

// In-memory store for auth codes (valid for 5 minutes)
// Fine for a single-user server — codes are short-lived anyway
const authCodes = new Map();

function generateCode() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req, context) {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ── OAuth Protected Resource Metadata ────────────────────────────────────
  if (path === '/.well-known/oauth-protected-resource') {
    return json({
      resource: `${BASE_URL}/mcp`,
      authorization_servers: [BASE_URL],
      bearer_methods_supported: ['header'],
      scopes_supported: ['mcp:tools'],
    });
  }

  // ── OAuth Authorization Server Metadata ──────────────────────────────────
  if (path === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: BASE_URL,
      authorization_endpoint: `${BASE_URL}/authorize`,
      token_endpoint: `${BASE_URL}/oauth/token`,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      grant_types_supported: ['authorization_code', 'client_credentials'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:tools'],
      response_types_supported: ['code'],
    });
  }

  // ── Authorization Endpoint ────────────────────────────────────────────────
  // Auto-approves and immediately redirects back with an auth code.
  // Claude.ai hits this in the browser as part of the PKCE flow.
  if (path === '/authorize' && req.method === 'GET') {
    const redirectUri    = url.searchParams.get('redirect_uri');
    const state          = url.searchParams.get('state');
    const codeChallenge  = url.searchParams.get('code_challenge');
    const clientId       = url.searchParams.get('client_id');

    // Validate client ID
    if (clientId !== process.env.OAUTH_CLIENT_ID) {
      return new Response('Unauthorized client', { status: 401 });
    }

    if (!redirectUri) {
      return new Response('Missing redirect_uri', { status: 400 });
    }

    // Generate a short-lived auth code and store with the PKCE challenge
    const code = generateCode();
    authCodes.set(code, {
      codeChallenge,
      redirectUri,
      createdAt: Date.now(),
    });

    // Clean up codes older than 5 minutes
    for (const [k, v] of authCodes.entries()) {
      if (Date.now() - v.createdAt > 300_000) authCodes.delete(k);
    }

    // Redirect back to Claude.ai with the code
    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    return new Response(null, {
      status: 302,
      headers: { Location: callbackUrl.toString() },
    });
  }

  // ── Token Endpoint ────────────────────────────────────────────────────────
  // Handles both authorization_code and client_credentials grant types.
  if (path === '/oauth/token' && req.method === 'POST') {
    const contentType = req.headers.get('content-type') || '';
    let params;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text();
      params = Object.fromEntries(new URLSearchParams(text));
    } else if (contentType.includes('application/json')) {
      params = await req.json();
    } else {
      const text = await req.text();
      params = Object.fromEntries(new URLSearchParams(text));
    }

    // Also support HTTP Basic auth for client_id/secret
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader.startsWith('Basic ')) {
      const decoded = atob(authHeader.slice(6));
      const [basicId, basicSecret] = decoded.split(':');
      params.client_id     = params.client_id     || basicId;
      params.client_secret = params.client_secret || basicSecret;
    }

    const { grant_type, code, code_verifier, client_id } = params;

    // ── Authorization code grant (PKCE) ──
    if (grant_type === 'authorization_code') {
      if (!code) return json({ error: 'invalid_request', error_description: 'Missing code' }, 400);

      const stored = authCodes.get(code);
      if (!stored) return json({ error: 'invalid_grant', error_description: 'Unknown or expired code' }, 400);

      // Verify PKCE code_verifier against stored challenge
      if (stored.codeChallenge && code_verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(code_verifier);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const computedChallenge = btoa(String.fromCharCode(...hashArray))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        if (computedChallenge !== stored.codeChallenge) {
          return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
        }
      }

      authCodes.delete(code);

      return json({
        access_token: process.env.MCP_AUTH_TOKEN,
        token_type: 'Bearer',
        expires_in: 7776000,
        scope: 'mcp:tools',
      });
    }

    // ── Client credentials grant ──
    if (grant_type === 'client_credentials') {
      if (client_id !== process.env.OAUTH_CLIENT_ID) {
        return json({ error: 'invalid_client' }, 401);
      }
      return json({
        access_token: process.env.MCP_AUTH_TOKEN,
        token_type: 'Bearer',
        expires_in: 7776000,
        scope: 'mcp:tools',
      });
    }

    return json({ error: 'unsupported_grant_type' }, 400);
  }

  return new Response('Not Found', { status: 404 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
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
    '/authorize',
    '/oauth/token',
  ],
};
