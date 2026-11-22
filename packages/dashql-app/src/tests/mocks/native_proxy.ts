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

/// The gRPC channel that the native proxy of the tests opens
export const TEST_CHANNEL_ID = 3;
/// The gRPC stream that the native proxy of the tests opens on its channel
export const TEST_STREAM_ID = 7;

/// A native proxy with the gRPC channel TEST_CHANNEL_ID and the stream TEST_STREAM_ID that answers the stream reads with
/// the batches
export function installNativeGrpcProxy(batches: Response[]) {
    const seen: NativeProxyRequest[] = [];
    const proxy = installNativeProxy(request => {
        seen.push(request);
        if (request.method === 'POST' && request.path === '/grpc/channels') return new Response(null, { headers: { 'dashql-channel-id': `${TEST_CHANNEL_ID}` } });
        if (request.method === 'POST' && request.path === `/grpc/channel/${TEST_CHANNEL_ID}/streams`) return new Response(null, { headers: { 'dashql-stream-id': `${TEST_STREAM_ID}` } });
        if (request.method === 'GET') return batches.shift()!;
        return new Response(null);
    });
    return { ...proxy, seen };
}

