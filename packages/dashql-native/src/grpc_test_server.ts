import {createServer, type IncomingHttpHeaders, type ServerHttp2Session, type ServerHttp2Stream} from "node:http2";

const REQUEST_MESSAGE = Uint8Array.of(0x0a, 0x01, 0x71);
const UNARY_RESPONSE = Uint8Array.of(0x0a, 0x01, 0x75);
const STREAM_RESPONSE_A = Uint8Array.of(0x0a, 0x01, 0x61);
const STREAM_RESPONSE_B = Uint8Array.of(0x0a, 0x01, 0x62);

function encodeGrpcFrame(message: Uint8Array): Buffer {
    const frame = Buffer.alloc(5 + message.byteLength);
    frame[0] = 0;
    frame.writeUInt32BE(message.byteLength, 1);
    Buffer.from(message).copy(frame, 5);
    return frame;
}

export class GrpcTestServer {
    readonly requests: Array<{headers: IncomingHttpHeaders; message: Uint8Array}> = [];
    private readonly server = createServer();
    private readonly sessions = new Set<ServerHttp2Session>();
    private error: Error | null = null;
    endpoint: string | null = null;

    constructor() {
        this.server.on("session", (session) => {
            this.sessions.add(session);
            session.on("close", () => this.sessions.delete(session));
        });
        this.server.on("stream", (stream, headers) => {
            void this.handleStream(stream, headers);
        });
    }

    async start(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(0, "127.0.0.1", resolve);
        });
        const address = this.server.address();
        if (address === null || typeof address === "string") {
            throw new Error("gRPC test server did not bind a TCP port");
        }
        this.endpoint = `http://127.0.0.1:${address.port}`;
    }

    assertHealthy(): void {
        if (this.error !== null) throw this.error;
    }

    async close(): Promise<void> {
        for (const session of this.sessions) session.destroy();
        this.sessions.clear();
        await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }

    private async handleStream(stream: ServerHttp2Stream, headers: IncomingHttpHeaders): Promise<void> {
        try {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const frame = Buffer.concat(chunks);
            if (headers[":method"] !== "POST") throw new Error(`Unexpected gRPC method: ${headers[":method"]}`);
            if (frame.byteLength !== 5 + REQUEST_MESSAGE.byteLength || frame[0] !== 0 ||
                frame.readUInt32BE(1) !== REQUEST_MESSAGE.byteLength ||
                Buffer.compare(frame.subarray(5), REQUEST_MESSAGE) !== 0) {
                throw new Error("Unexpected gRPC request frame");
            }
            if (headers["dashql-path"] !== undefined) throw new Error("dashql-path leaked into gRPC metadata");
            this.requests.push({headers, message: frame.subarray(5)});

            const path = headers[":path"];
            if (path === "/dashql.test.TestService/TestUnary") {
                this.respond(stream, "unary", [UNARY_RESPONSE]);
            } else if (path === "/dashql.test.TestService/TestServerStreaming") {
                this.respond(stream, "stream", [STREAM_RESPONSE_A, STREAM_RESPONSE_B]);
            } else {
                throw new Error(`Unexpected gRPC path: ${path}`);
            }
        } catch (error) {
            this.error = error instanceof Error ? error : new Error(String(error));
            if (!stream.headersSent) {
                stream.respond({":status": 200, "content-type": "application/grpc+proto"}, {waitForTrailers: true});
            }
            stream.on("wantTrailers", () => stream.sendTrailers({"grpc-message": "test-server-failure", "grpc-status": "13"}));
            stream.end();
        }
    }

    private respond(stream: ServerHttp2Stream, kind: "stream" | "unary", messages: Uint8Array[]): void {
        stream.respond({
            ":status": 200,
            "content-type": "application/grpc+proto",
            "x-test-initial": kind,
        }, {waitForTrailers: true});
        stream.on("wantTrailers", () => stream.sendTrailers({
            "grpc-status": "0",
            "x-test-trailer": `${kind}-done`,
        }));
        for (const message of messages) stream.write(encodeGrpcFrame(message));
        stream.end();
    }
}

export const GRPC_TEST_REQUEST = REQUEST_MESSAGE;
export const GRPC_TEST_STREAM_BODY = Uint8Array.of(
    3, 0, 0, 0, 0x0a, 0x01, 0x61,
    3, 0, 0, 0, 0x0a, 0x01, 0x62,
);
export const GRPC_TEST_UNARY_RESPONSE = UNARY_RESPONSE;
