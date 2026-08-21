import { vi } from 'vitest';

import * as proto from "../../proto.js";
import * as buf from "@bufbuild/protobuf";

import { NativeAPIRustBridge } from '../native_api_rust_bridge.js';
import { TestHyperGrpcServer } from '../native_proxy_test_servers.js';
import { NativeGrpcChannel, NativeGrpcClient, NativeGrpcServerStreamBatchEvent } from './native_grpc_client.js';
import { ChannelArgs, ChannelMetadataProvider } from '../channel_common.js';
import { TestLogger } from '../logger/test_logger.js';
import {
    HEADER_NAME_ENDPOINT,
    HEADER_NAME_READ_TIMEOUT,
    HEADER_NAME_TLS,
    HEADER_NAME_TLS_CACERTS,
    HEADER_NAME_TLS_CLIENT_CERT,
    HEADER_NAME_TLS_CLIENT_KEY,
} from '../native_proxy_headers.js';

describe('Native gRPC client', () => {
    let bridge: NativeAPIRustBridge;
    beforeEach(() => {
        bridge = new NativeAPIRustBridge();
        vi.spyOn(globalThis, 'fetch').mockImplementation((req) => bridge.process(req as Request));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        bridge.close();
    });
    const fakeMetadataProvider: ChannelMetadataProvider = {
        getRequestMetadata(): Promise<Record<string, string>> {
            return Promise.resolve({});
        }
    };

    it("can create a channel", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        const testChannelArgs: ChannelArgs = {
            endpoint: server.endpoint!,
        };
        await expect(client.connect(testChannelArgs, fakeMetadataProvider)).resolves.toBeDefined();
        await server.close();
    });

    it("forwards TLS certificate paths when creating a channel", async () => {
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValue(new Response(null, {
            status: 200,
            headers: { "dashql-channel-id": "1" },
        }));
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());

        await client.connect({
            endpoint: "https://hyper.example.com:443",
            tls: {
                keyPath: "/certs/client.key",
                pubPath: "/certs/client.pem",
                caPath: "/certs/ca.pem",
            },
        }, fakeMetadataProvider);

        const request = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as Request;
        expect(request.headers.get(HEADER_NAME_ENDPOINT)).toBe("https://hyper.example.com:443");
        expect(request.headers.get(HEADER_NAME_TLS)).toBe("1");
        expect(request.headers.get(HEADER_NAME_TLS_CLIENT_KEY)).toBe("/certs/client.key");
        expect(request.headers.get(HEADER_NAME_TLS_CLIENT_CERT)).toBe("/certs/client.pem");
        expect(request.headers.get(HEADER_NAME_TLS_CACERTS)).toBe("/certs/ca.pem");
    });

    it("omits empty TLS certificate path headers", async () => {
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValue(new Response(null, {
            status: 200,
            headers: { "dashql-channel-id": "1" },
        }));
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());

        await client.connect({
            endpoint: "https://hyper.example.com:443",
            tls: {},
        }, fakeMetadataProvider);

        const request = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as Request;
        expect(request.headers.get(HEADER_NAME_TLS)).toBe("1");
        expect(request.headers.has(HEADER_NAME_TLS_CLIENT_KEY)).toBe(false);
        expect(request.headers.has(HEADER_NAME_TLS_CLIENT_CERT)).toBe(false);
        expect(request.headers.has(HEADER_NAME_TLS_CACERTS)).toBe(false);
    });

    it("fails to create a channel with invalid foundations URL", async () => {
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("not-dashql-native://localhost")
        }, logger);
        const testChannelArgs: ChannelArgs = {
            endpoint: "http://127.0.0.1:8080"
        };
        await expect(client.connect(testChannelArgs, fakeMetadataProvider)).rejects.toThrow();
    });

    it("starts a streaming gRPC call", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        const testChannelArgs: ChannelArgs = {
            endpoint: server.endpoint!,
        };
        const channel = await client.connect(testChannelArgs, fakeMetadataProvider);
        expect(channel.channelId).not.toBeNull();
        expect(channel.channelId).not.toBeNaN();

        server.executeQueryHandler = async () => ({
            messages: [
                buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$),
            ],
        });

        const params = buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        });
        await channel.startServerStream({
            path: "/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery",
            body: buf.toBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, params),
        });
        expect(server.executeQueryRequests).toHaveLength(1);
        expect(server.executeQueryRequests[0].query).toEqual("select 1");
        await server.close();
    });

    it("forwards request metadata when starting a stream", async () => {
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValue(new Response(null, {
            status: 200,
            headers: { "dashql-stream-id": "1" },
        }));
        const metadataProvider: ChannelMetadataProvider = {
            getRequestMetadata: () => Promise.resolve({ "ctx-tenant-id": "tenant-123" }),
        };
        const channel = new NativeGrpcChannel({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, 7, metadataProvider, new TestLogger());

        await channel.startServerStream({ path: "/test.Service/Stream", body: new Uint8Array() });

        const request = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as Request;
        expect(request.headers.get("ctx-tenant-id")).toBe("tenant-123");
    });

    it("uses the configured stream read timeout", async () => {
        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockResolvedValueOnce(new Response(null, {
            status: 200,
            headers: { "dashql-stream-id": "1" },
        }));
        fetchMock.mockResolvedValueOnce(new Response(null, {
            status: 200,
            headers: {
                "dashql-batch-event": "StreamFinished",
                "dashql-batch-messages": "0",
            },
        }));
        const channel = new NativeGrpcChannel({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, 7, fakeMetadataProvider, new TestLogger());

        const stream = await channel.startServerStream({
            path: "/test.Service/Stream",
            body: new Uint8Array(),
            readTimeoutMs: 60_000,
        });
        await stream.read();

        const request = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as Request;
        expect(request.headers.get(HEADER_NAME_READ_TIMEOUT)).toBe("60000");
    });

    it("reads from a gRPC output stream", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        const testChannelArgs: ChannelArgs = {
            endpoint: server.endpoint!,
        };
        const channel = await client.connect(testChannelArgs, fakeMetadataProvider);
        expect(channel.channelId).not.toBeNull();
        expect(channel.channelId).not.toBeNaN();

        const headerMessage = buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$, {
            result: {
                case: "header",
                value: buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultHeaderSchema, {
                    header: {
                        case: "schema",
                        value: buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultSchemaSchema, {
                            column: []
                        })
                    }
                }),
            }
        });

        server.executeQueryHandler = async () => ({
            messages: [headerMessage],
        });

        const params = buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        });
        const stream = await channel.startServerStream({
            path: "/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery",
            body: buf.toBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, params)
        });
        expect(server.executeQueryRequests).toHaveLength(1);
        expect(server.executeQueryRequests[0].query).toEqual("select 1");
        expect(stream.streamId).not.toBeNull();
        expect(stream.streamId).not.toBeNaN();

        const result = await stream.read();
        expect(result).not.toBeNull();
        expect(result.event).toEqual(NativeGrpcServerStreamBatchEvent.StreamFinished);
        expect(result.messages.length).toEqual(1);

        await expect(stream.read()).rejects.toThrow("gRPC stream is unknown");
        await server.close();
    });
});
