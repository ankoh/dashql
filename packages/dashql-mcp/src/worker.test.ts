import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

import { handleRequest, PROTOCOL_VERSIONS, renderView, RESOURCE_MIME_TYPE, RESOURCE_URI, TOOL_NAME, type Env } from './worker.js';

const ENV: Env = { CHANNEL: 'dev', APP_ORIGIN: 'https://dev.dashql.app' };
const URL_MCP = 'https://mcp.dashql.app/dev/mcp';

function post(body: unknown): Promise<Response> {
    return handleRequest(new Request(URL_MCP, { method: 'POST', body: JSON.stringify(body) }), ENV);
}

describe('the MCP server', () => {
    it('answers the client of the MCP SDK', async () => {
        const client = new Client({ name: 'test', version: '1.0.0' });
        const fetchWorker = (input: string | URL | Request, init?: RequestInit) => handleRequest(new Request(input, init), ENV);
        await client.connect(new StreamableHTTPClientTransport(new URL(URL_MCP), { fetch: fetchWorker }));

        const { tools } = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual([TOOL_NAME]);
        expect(tools[0]._meta).toEqual({ ui: { resourceUri: RESOURCE_URI } });

        const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
        expect(result.isError).toBeFalsy();

        const { contents } = await client.readResource({ uri: RESOURCE_URI });
        expect(contents).toHaveLength(1);
        expect(contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);
        expect(contents[0]._meta).toEqual({ ui: { csp: { frameDomains: ['https://dev.dashql.app'] } } });
        expect('text' in contents[0] ? contents[0].text : '').toContain('"https://dev.dashql.app/embed"');
        await client.close();
    });

    it('offers its newest revision of MCP for an unknown one', async () => {
        const response = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
        expect((await response.json()).result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    });

    it('answers a notification with 202 and nothing else', async () => {
        const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(response.status).toBe(202);
        expect(await response.text()).toBe('');
    });

    it('rejects unknown methods, tools and resources', async () => {
        expect((await (await post({ jsonrpc: '2.0', id: 1, method: 'prompts/list' })).json()).error.code).toBe(-32601);
        const tool = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'other' } });
        expect((await tool.json()).error.code).toBe(-32602);
        const resource = await post({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://other' } });
        expect((await resource.json()).error.code).toBe(-32002);
    });

    it('serves only POST on the path of its channel', async () => {
        expect((await handleRequest(new Request('https://mcp.dashql.app/stable/mcp', { method: 'POST' }), ENV)).status).toBe(404);
        expect((await handleRequest(new Request(URL_MCP), ENV)).status).toBe(405);
        expect((await handleRequest(new Request(URL_MCP, { method: 'POST', body: '{' }), ENV)).status).toBe(400);
    });

    it('keeps the embed URL inside its script', () => {
        expect(renderView('https://x.test/</script><script>alert(1)</script>')).not.toContain('</script><script>alert');
    });
});
