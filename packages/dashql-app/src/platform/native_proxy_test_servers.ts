import * as buf from '@bufbuild/protobuf';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';

import * as proto from '../proto.js';

export type TestHttpRequest = {
    method: string;
    path: string;
    headers: http.IncomingHttpHeaders;
    body: Uint8Array;
};

export class TestHttpServer {
    server: http.Server;
    endpoint: string | null;
    handler: ((request: TestHttpRequest, response: http.ServerResponse) => void | Promise<void>) | null;
    requests: TestHttpRequest[];

    constructor() {
        this.endpoint = null;
        this.handler = null;
        this.requests = [];
        this.server = http.createServer(async (request, response) => {
            const chunks: Buffer[] = [];
            for await (const chunk of request) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const body = Buffer.concat(chunks);
            const record: TestHttpRequest = {
                method: request.method ?? 'GET',
                path: request.url ?? '/',
                headers: request.headers,
                body: new Uint8Array(body),
            };
            this.requests.push(record);
            if (this.handler == null) {
                response.statusCode = 500;
                response.end();
                return;
            }
            await this.handler(record, response);
        });
    }

    async start(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                this.server.removeListener('error', onError);
                reject(error);
            };
            this.server.addListener('error', onError);
            this.server.listen(0, '127.0.0.1', () => {
                this.server.removeListener('error', onError);
                resolve();
            });
        });
        const address = this.server.address();
        if (address == null || typeof address === 'string') {
            throw new Error('failed to resolve http test server address');
        }
        this.endpoint = `http://127.0.0.1:${address.port}`;
    }

    async close(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.server.close((error) => {
                if (error != null) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
}

type ExecuteQueryHandlerResult = {
    metadata?: Record<string, string>;
    messages: any[];
};

function encodeGrpcFrame(payload: Uint8Array): Uint8Array {
    const frame = new Uint8Array(payload.byteLength + 5);
    frame[0] = 0;
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    view.setUint32(1, payload.byteLength, false);
    frame.set(payload, 5);
    return frame;
}

function decodeGrpcFrames(buffer: Uint8Array): Uint8Array[] {
    const messages: Uint8Array[] = [];
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;
    while (offset < buffer.byteLength) {
        const compressed = view.getUint8(offset);
        offset += 1;
        if (compressed !== 0) {
            throw new Error('compressed grpc frames are not supported in tests');
        }
        const length = view.getUint32(offset, false);
        offset += 4;
        messages.push(buffer.slice(offset, offset + length));
        offset += length;
    }
    return messages;
}

export class TestHyperGrpcServer {
    server: http2.Http2Server;
    endpoint: string | null;
    sessions: Set<http2.ServerHttp2Session>;
    executeQueryRequests: proto.salesforce_hyperdb_grpc_v1.pb.QueryParam[];
    executeQueryHandler: ((request: proto.salesforce_hyperdb_grpc_v1.pb.QueryParam) => ExecuteQueryHandlerResult | Promise<ExecuteQueryHandlerResult>) | null;

    constructor() {
        this.endpoint = null;
        this.sessions = new Set();
        this.executeQueryRequests = [];
        this.executeQueryHandler = null;
        this.server = http2.createServer();
        this.server.on('session', (session) => {
            const typed = session as http2.ServerHttp2Session;
            this.sessions.add(typed);
            typed.on('close', () => {
                this.sessions.delete(typed);
            });
        });
        this.server.on('stream', (stream, headers) => {
            void this.handleStream(stream as http2.ServerHttp2Stream, headers);
        });
    }

    async start(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                this.server.removeListener('error', onError);
                reject(error);
            };
            this.server.addListener('error', onError);
            this.server.listen(0, '127.0.0.1', () => {
                this.server.removeListener('error', onError);
                resolve();
            });
        });
        const address = this.server.address();
        if (address == null || typeof address === 'string') {
            throw new Error('failed to resolve grpc test server address');
        }
        this.endpoint = `http://127.0.0.1:${address.port}`;
    }

    async close(): Promise<void> {
        for (const session of this.sessions) {
            session.destroy();
        }
        this.sessions.clear();
        await new Promise<void>((resolve, reject) => {
            this.server.close((error) => {
                if (error != null) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    async handleStream(stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders): Promise<void> {
        try {
            const method = headers[':method'];
            const path = headers[':path'];
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const body = new Uint8Array(Buffer.concat(chunks));
            if (method !== 'POST' || path !== '/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery') {
                this.respondGrpcError(stream, '12', `unsupported path: ${String(path)}`);
                return;
            }
            if (this.executeQueryHandler == null) {
                this.respondGrpcError(stream, '13', 'executeQueryHandler is not configured');
                return;
            }
            const [message] = decodeGrpcFrames(body);
            const request = buf.fromBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, message) as proto.salesforce_hyperdb_grpc_v1.pb.QueryParam;
            this.executeQueryRequests.push(request);
            const result = await this.executeQueryHandler(request);
            stream.respond({
                ':status': 200,
                'content-type': 'application/grpc+proto',
                ...result.metadata,
            }, {
                waitForTrailers: true,
            });
            stream.on('wantTrailers', () => {
                stream.sendTrailers({
                    'grpc-status': '0',
                });
            });
            for (const response of result.messages) {
                const encoded = buf.toBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$, response);
                stream.write(encodeGrpcFrame(encoded));
            }
            stream.end();
        } catch (error) {
            this.respondGrpcError(stream, '13', error instanceof Error ? error.message : String(error));
        }
    }

    respondGrpcError(stream: http2.ServerHttp2Stream, grpcStatus: string, message: string): void {
        stream.respond({
            ':status': 200,
            'content-type': 'application/grpc+proto',
        }, {
            waitForTrailers: true,
        });
        stream.on('wantTrailers', () => {
            stream.sendTrailers({
                'grpc-status': grpcStatus,
                'grpc-message': encodeURIComponent(message),
            });
        });
        stream.end();
    }
}

export async function getUnusedLocalEndpoint(): Promise<string> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            resolve();
        });
        server.on('error', reject);
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error != null) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
    if (address == null || typeof address === 'string') {
        throw new Error('failed to reserve local endpoint');
    }
    return `http://127.0.0.1:${address.port}`;
}
