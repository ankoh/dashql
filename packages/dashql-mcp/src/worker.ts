// The MCP server of DashQL as a Cloudflare Worker, see README.md. It has one tool, an MCP App whose view frames the
// embed of the channel's app: a test of whether a host such as ChatGPT can run the embedded Hyper (docs/wip/embeds.md).
//
// One Worker per channel (dev, stable, latest) on mcp.dashql.app/<channel>/mcp. The server is stateless: Streamable
// HTTP with JSON responses and no session. The host renders the view in a sandboxed iframe of its own origin, so the
// view is never cross-origin isolated; the engine runs in the embed, which sends Document-Isolation-Policy and lists
// the hosts in its frame-ancestors (packages/dashql-app/_headers).

export interface Env {
    // dev, stable or latest, the first segment of the paths of this Worker
    CHANNEL: string;
    // The origin of the app whose embed the view frames, e.g. https://dev.dashql.app
    APP_ORIGIN: string;
}

// The revisions of MCP this server answers in, the first is the one it offers when a client asks for another
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

export const TOOL_NAME = 'probe_embed';
export const RESOURCE_URI = 'ui://dashql/embed-probe.html';
export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

export default {
    fetch(request: Request, env: Env): Promise<Response> {
        return handleRequest(request, env);
    },
};

export async function handleRequest(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== `/${env.CHANNEL}/mcp`) {
        return new Response('not found\n', { status: 404 });
    }
    if (request.method !== 'POST') {
        return new Response('method not allowed\n', { status: 405, headers: { allow: 'POST' } });
    }
    let message: { id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
        message = JSON.parse(await request.text());
    } catch {
        return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
    }
    // A notification or a response of the client needs no answer
    if (message?.id === undefined || typeof message.method !== 'string') {
        return new Response(null, { status: 202 });
    }
    return Response.json({ jsonrpc: '2.0', id: message.id, ...answer(message.method, message.params ?? {}, env) });
}

function answer(method: string, params: Record<string, unknown>, env: Env): { result: object } | { error: object } {
    const embedUrl = `${env.APP_ORIGIN}/embed`;
    const meta = { ui: { csp: { frameDomains: [env.APP_ORIGIN] } } };
    switch (method) {
        case 'initialize': {
            const requested = params.protocolVersion;
            return {
                result: {
                    protocolVersion: PROTOCOL_VERSIONS.includes(requested as string) ? requested : PROTOCOL_VERSIONS[0],
                    capabilities: { tools: {}, resources: {} },
                    serverInfo: { name: 'dashql', version: '0.1.0' },
                },
            };
        }
        case 'ping':
            return { result: {} };
        case 'tools/list':
            return {
                result: {
                    tools: [
                        {
                            name: TOOL_NAME,
                            description:
                                'Shows the DashQL embed, which runs a test query in the browser. Use it when the user asks to test or probe DashQL.',
                            inputSchema: { type: 'object', properties: {} },
                            annotations: { readOnlyHint: true },
                            _meta: { ui: { resourceUri: RESOURCE_URI } },
                        },
                    ],
                },
            };
        case 'tools/call':
            if (params.name !== TOOL_NAME) {
                return { error: { code: -32602, message: `Unknown tool: ${String(params.name)}` } };
            }
            return { result: { content: [{ type: 'text', text: `The view shows the DashQL embed at ${embedUrl}.` }] } };
        case 'resources/list':
            return { result: { resources: [{ uri: RESOURCE_URI, name: 'embed-probe', mimeType: RESOURCE_MIME_TYPE, _meta: meta }] } };
        case 'resources/read':
            if (params.uri !== RESOURCE_URI) {
                return { error: { code: -32002, message: `Resource not found: ${String(params.uri)}` } };
            }
            return {
                result: {
                    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: renderView(embedUrl), _meta: meta }],
                },
            };
        default:
            return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
}

/// The view: the handshake of MCP Apps (ui/initialize, then ui/notifications/initialized), a line about the frame it
/// got, and the embed below it, which reports the engine itself
export function renderView(embedUrl: string): string {
    // The URL may not close the script element early
    const config = JSON.stringify(embedUrl).replaceAll('<', '\\u003c');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
body { margin: 0; font: 13px system-ui, sans-serif; }
pre { margin: 0; padding: 8px; white-space: pre-wrap; word-break: break-all; }
iframe { display: block; width: 100%; height: 560px; border: 0; }
</style>
</head>
<body>
<pre id="report"></pre>
<script type="module">
const embedUrl = ${config};
const send = message => window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*');
window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window.parent || message?.jsonrpc !== '2.0') return;
    if (message.id === 1 && message.method === undefined) {
        send({ method: 'ui/notifications/initialized', params: {} });
        const granted = message.result?.hostCapabilities?.sandbox?.csp?.frameDomains;
        report('frameDomains granted: ' + (granted ? JSON.stringify(granted) : 'not reported'));
    } else if (message.id !== undefined && message.method !== undefined) {
        // A request of the host, e.g. ping
        send({ id: message.id, result: {} });
    }
});
document.addEventListener('securitypolicyviolation', event => report('blocked: ' + event.effectiveDirective + ' ' + event.blockedURI));
function report(line) {
    document.getElementById('report').textContent += line + '\\n';
    send({ method: 'ui/notifications/size-changed', params: { height: document.documentElement.scrollHeight } });
}
report('view origin: ' + self.origin + ', crossOriginIsolated: ' + globalThis.crossOriginIsolated);
report('userAgent: ' + navigator.userAgent);
send({
    id: 1,
    method: 'ui/initialize',
    params: { appInfo: { name: 'DashQL embed probe', version: '0.1.0' }, appCapabilities: {}, protocolVersion: '2026-01-26' },
});
const frame = document.createElement('iframe');
frame.src = embedUrl;
document.body.append(frame);
</script>
</body>
</html>
`;
}
