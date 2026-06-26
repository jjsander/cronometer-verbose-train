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

export default {
  async fetch(request, env, ctx) {
    globalThis.process = { env };

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/mcp' || path === '/') {
      return mcpHandler(request, {});
    }

    if (path === '/.well-known/oauth-protected-resource') {
      return new Response(JSON.stringify({
        resource: url.origin,
        authorization_servers: [],
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
