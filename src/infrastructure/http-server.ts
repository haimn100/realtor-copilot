import { createServer, type Server } from 'node:http';
import { NodeStreamableHTTPServerTransport, hostHeaderValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import { RealtorClientService } from '../application/client-service.js';
import { SupabaseClientRepository } from '../data/supabase-client-repository.js';
import { RealtorPropertyService } from '../application/property-service.js';
import { SupabasePropertyRepository } from '../data/supabase-property-repository.js';
import { AppError } from '../domain/errors.js';
import { createMcpServer } from '../mcp/server.js';
import type { IdentityProvider } from './identity.js';
import type { Config } from './config.js';
import { ClientImportService, SupabaseImportStore } from '../import/client-import.js';

export function createHttpServer(identity: IdentityProvider, config?: Pick<Config, 'NODE_ENV' | 'DEV_TUNNEL_URL'>): Server {
  if (config?.DEV_TUNNEL_URL && config.NODE_ENV !== 'development') throw new Error('Tunnel access requires development mode.');
  const tunnelOrigin = config?.DEV_TUNNEL_URL;
  const validateHost = hostHeaderValidation(['localhost', '127.0.0.1', '[::1]',
    ...(tunnelOrigin ? [new URL(tunnelOrigin).hostname] : []),
  ]);
  const validateLocalOrigin = localhostOriginValidation();
  return createServer(async (request, response) => {
    // The tunnel must preserve Host. Forwarded headers never expand this policy
    // or select an identity. Non-browser MCP clients may omit Origin.
    if (!validateHost(request, response)) return;
    if (!(tunnelOrigin && request.headers.origin === tunnelOrigin) && !validateLocalOrigin(request, response)) return;
    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}');
      return;
    }
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end('Stateless MCP endpoint accepts POST.'); return;
    }
    let server: ReturnType<typeof createMcpServer> | undefined;
    try {
      const context = await identity.resolve(request);
      server = createMcpServer(new RealtorClientService(new SupabaseClientRepository(context)),
        new RealtorPropertyService(new SupabasePropertyRepository(context)), new ClientImportService(new SupabaseImportStore(context)));
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 64 * 1024,
      });
      await server.connect(transport);
      response.once('close', () => { void server?.close(); });
      await transport.handleRequest(request, response);
    } catch (error) {
      if (!response.headersSent) {
        const status = error instanceof AppError ? error.code === 'FORBIDDEN' ? 403 : error.code === 'UNAUTHENTICATED' ? 401 : 500 : 500;
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          error: error instanceof AppError ? error.message : 'MCP request failed.',
        }));
      } else response.end();
      await server?.close();
    }
  });
}
