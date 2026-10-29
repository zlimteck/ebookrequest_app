#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createApi, buildServer } from './mcpServer.js';

const TOKEN = process.env.EBOOKREQUEST_TOKEN || '';
const MODE  = process.env.MCP_MODE || 'stdio';
const PORT  = parseInt(process.env.MCP_PORT || '3035', 10);

if (!process.env.EBOOKREQUEST_URL) {
  console.error('EBOOKREQUEST_URL est requis.');
  process.exit(1);
}

if (MODE !== 'http' && !TOKEN) {
  console.error('EBOOKREQUEST_TOKEN est requis en mode stdio.');
  process.exit(1);
}

if (MODE === 'http') {
  // L'OAuth (feat/mcp-oauth) n'est utile qu'en mode http (Claude web/iOS) —
  // TOKEN reste optionnel dans ce mode (repli legacy uniquement si
  // configuré), mais ces 5-là sont indispensables pour que le flux OAuth
  // fonctionne.
  const missing = ['MCP_URL', 'MONGODB_URI', 'MCP_OAUTH_JWT_SECRET', 'MCP_LOGIN_TICKET_SECRET', 'MCP_INTERNAL_SERVICE_SECRET']
    .filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Variables d'environnement requises manquantes pour le flux OAuth MCP : ${missing.join(', ')}`);
    process.exit(1);
  }

  const { createHttpApp } = await import('./httpApp.js');
  const { app, resourceUrl } = await createHttpApp({ staticFallbackToken: TOKEN });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EbookRequest MCP server (HTTP) running on :${PORT}, OAuth resource: ${resourceUrl}`);
  });
} else {
  const api = createApi(TOKEN);
  const transport = new StdioServerTransport();
  await buildServer(api).connect(transport);
}
