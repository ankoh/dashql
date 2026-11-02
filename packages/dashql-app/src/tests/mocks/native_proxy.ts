/// A request of the native proxy of the Electron bridge
export interface NativeProxyRequest {
    method: string;
    path: string;
    headers: Headers;
    body: Uint8Array;
}

/// Let the native proxy of the Electron bridge answer requests with the handler, or with the responses in order.
/// Records the requests as `METHOD /path`. Reset globalThis.dashqlElectron after the test.
export function installNativeProxy(answer: ((request: NativeProxyRequest) => Response | Promise<Response>) | Response[]) {
    const requests: string[] = [];
    const handler = Array.isArray(answer) ? () => answer.shift()! : answer;
    globalThis.dashqlElectron = {
        nativeProxyRequest: async (request: { method: string; url: string; headers: Array<[string, string]>; body: Uint8Array }) => {
            const path = new URL(request.url).pathname;
            requests.push(`${request.method} ${path}`);
            const response = await handler({ method: request.method, path, headers: new Headers(request.headers), body: request.body });
            return {
                status: response.status,
                statusText: response.statusText,
                headers: [...response.headers],
                body: new Uint8Array(await response.arrayBuffer()),
            };
        },
    } as unknown as DashQLElectronBridge;
    return { requests };
}

/// A batch of a gRPC server stream of the native proxy, every message prefixed with its length.
/// The message count header can differ from the messages to fake a corrupt batch.
export function nativeStreamBatch(event: string, messages: (string | Uint8Array)[], options: { count?: number; headers?: Record<string, string> } = {}): Response {
    const encoded = messages.map(message => typeof message === 'string' ? new TextEncoder().encode(message) : message);
    const body = new Uint8Array(encoded.reduce((size, message) => size + 4 + message.length, 0));
    let offset = 0;
    for (const message of encoded) {
        new DataView(body.buffer).setUint32(offset, message.length, true);
        body.set(message, offset + 4);
        offset += 4 + message.length;
    }
    return new Response(body as BodyInit, {
        headers: { 'dashql-batch-event': event, 'dashql-batch-messages': `${options.count ?? messages.length}`, ...options.headers },
    });
}

/// A native proxy with gRPC channel 3 and stream 7 that answers the stream reads with the batches
export function installNativeGrpcProxy(batches: Response[]) {
    const seen: NativeProxyRequest[] = [];
    const proxy = installNativeProxy(request => {
        seen.push(request);
        if (request.method === 'POST' && request.path === '/grpc/channels') return new Response(null, { headers: { 'dashql-channel-id': '3' } });
        if (request.method === 'POST' && request.path === '/grpc/channel/3/streams') return new Response(null, { headers: { 'dashql-stream-id': '7' } });
        if (request.method === 'GET') return batches.shift()!;
        return new Response(null);
    });
    return { ...proxy, seen };
}

