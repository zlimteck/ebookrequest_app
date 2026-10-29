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
  // L'OAuth (feat/mcp-oauth) est entièrement optionnel : une instance déjà
  // en prod avec juste EBOOKREQUEST_TOKEN (OpenWebUI/ChatMCP/Claude Desktop)
  // ne doit jamais cesser de démarrer simplement parce que ces 5 variables
  // n'ont pas été ajoutées — bloquer ici casserait le MCP de tout le monde
  // dès la mise à jour de l'image, pas seulement de ceux qui veulent OAuth.
  const oauthVars = ['MCP_URL', 'MONGODB_URI', 'MCP_OAUTH_JWT_SECRET', 'MCP_LOGIN_TICKET_SECRET', 'MCP_INTERNAL_SERVICE_SECRET'];
  const missing = oauthVars.filter((name) => !process.env[name]);
  const oauthEnabled = missing.length === 0;
  if (!oauthEnabled && missing.length < oauthVars.length) {
    console.warn(`OAuth MCP désactivé : variables manquantes (${missing.join(', ')}). Le serveur démarre quand même en mode token statique uniquement.`);
  }

  const { createHttpApp } = await import('./httpApp.js');
  const { app, resourceUrl } = await createHttpApp({ staticFallbackToken: TOKEN, oauthEnabled });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EbookRequest MCP server (HTTP) running on :${PORT}${oauthEnabled ? `, OAuth resource: ${resourceUrl}` : ' (OAuth désactivé, token statique uniquement)'}`);
  });
} else {
  const api = createApi(TOKEN);
  const transport = new StdioServerTransport();
  await buildServer(api).connect(transport);
}
