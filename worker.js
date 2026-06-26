/**
 * Cloudflare Workers entry point for cronometer-mcp.
 *
 * Routes:
 *   POST /mcp                                 → MCP JSON-RPC handler
 *   GET  /.well-known/oauth-protected-resource → OAuth metadata
 *   GET  /.well-known/oauth-authorization-server → OAuth metadata
 *   GET  /authorize                           → OAuth authorize (auto-approve)
 *   POST /oauth/token                         → OAuth token exchange
 */

import mcpHandler from './netlify/functions/mcp.js';
import oauthHandler from './netlify/functions/oauth.js';

export default {
  async fetch(request, env, ctx) {
    // Polyfill process.env so existing function code works unchanged
    globalThis.process = { env };

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/mcp' || path === '/') {
      return mcpHandler(request, {});
    }

    if (
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-authorization-server' ||
      path === '/authorize' ||
      path === '/oauth/token'
    ) {
      return oauthHandler(request, {});
    }

    return new Response('Not Found', { status: 404 });
  },
};
