import { loadConfig } from './infrastructure/config.js';
import { DevelopmentIdentityProvider } from './infrastructure/identity.js';
import { createHttpServer } from './infrastructure/http-server.js';

async function main() {
  const config = loadConfig();
  const identity = new DevelopmentIdentityProvider(config);
  await identity.initialize();
  const server = createHttpServer(identity, config);
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.listen(config.PORT, config.HOST, () => console.log(`Realtor Copilot MCP: http://${config.HOST}:${config.PORT}/mcp (development identity)`));
  if (config.DEV_TUNNEL_URL) {
    console.warn(`TEMPORARY PUBLIC DEVELOPMENT ACCESS: ${config.DEV_TUNNEL_URL}/mcp`);
    console.warn('No authentication: anyone reaching the tunnel can read/write development data as the fixed development user. Stop the tunnel immediately after testing.');
  }
  const shutdown = () => {
    identity.close();
    server.close();
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Startup failed.'); process.exitCode = 1; });
