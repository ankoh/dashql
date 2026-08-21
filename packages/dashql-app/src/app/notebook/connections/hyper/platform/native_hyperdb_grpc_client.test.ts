import { vi } from 'vitest';

import * as pb from "../../../../../proto.js";
import * as buf from "@bufbuild/protobuf";
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { NativeAPIRustBridge } from '../../../../../platform/native_api_rust_bridge.js';
import { TestHyperGrpcServer } from '../../../../../platform/native_proxy_test_servers.js';
import { NativeHyperDatabaseClient, NativeHyperQueryResultStream } from './native_hyperdb_grpc_client.js';
import { TestLogger } from '../../../../../platform/logger/test_logger.js';
import { AttachedDatabase, HyperDatabaseConnectionContext } from '../hyperdb_grpc_client.js';
import { NativeGrpcChannel } from '../../../../../platform/grpc/native_grpc_client.js';

describe('Native Hyper client', () => {
    let bridge: NativeAPIRustBridge;
    beforeEach(() => {
        bridge = new NativeAPIRustBridge();
        vi.spyOn(globalThis, 'fetch').mockImplementation((req) => bridge.process(req as Request));
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        await bridge.close();
    });
    const fakeConnection: HyperDatabaseConnectionContext = {
        getAttachedDatabases(): AttachedDatabase[] {
            return []
        },
        getRequestMetadata(): Promise<Record<string, string>> {
            return Promise.resolve({});
        },
        getQueryParameters(): Record<string, string> {
            return {};
        }
    };

    it("can create a channel", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = ({
            endpoint: server.endpoint!
        }) as connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        await expect(client.connect(testChannelArgs, fakeConnection)).resolves.toBeDefined();
        await server.close();
    });

    it("maps Hyper mTLS settings to native channel settings", async () => {
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());
        const connect = vi.spyOn(client.client, "connect").mockResolvedValue({} as NativeGrpcChannel);
        const params = {
            protocol: "V3_GRPC",
            endpoint: "https://hyper.example.com:443",
            tls: {
                clientKeyPath: "/certs/client.key",
                clientCertPath: "/certs/client.pem",
                caCertsPath: "/certs/ca.pem",
            },
        } as connection.HyperConnectionParams;

        await client.connect(params, fakeConnection);

        expect(connect).toHaveBeenCalledWith({
            endpoint: params.endpoint,
            tls: {
                keyPath: params.tls.clientKeyPath,
                pubPath: params.tls.clientCertPath,
                caPath: params.tls.caCertsPath,
            },
        }, fakeConnection);
    });

    it("does not enable TLS for a plaintext endpoint without certificate paths", async () => {
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());
        const connect = vi.spyOn(client.client, "connect").mockResolvedValue({} as NativeGrpcChannel);

        await client.connect({
            protocol: "V3_GRPC",
            endpoint: "http://localhost:7484",
            tls: { clientKeyPath: "", clientCertPath: "", caCertsPath: "" },
        }, fakeConnection);

        expect(connect).toHaveBeenCalledWith({
            endpoint: "http://localhost:7484",
            tls: undefined,
        }, fakeConnection);
    });

    it("rejects mTLS settings for a plaintext endpoint", async () => {
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());
        const connect = vi.spyOn(client.client, "connect");

        await expect(client.connect({
            protocol: "V3_GRPC",
            endpoint: "http://localhost:7484",
            tls: {
                clientKeyPath: "/certs/client.key",
                clientCertPath: "/certs/client.pem",
                caCertsPath: "/certs/ca.pem",
            },
        }, fakeConnection)).rejects.toThrow("TLS certificate paths require an https:// endpoint");
        expect(connect).not.toHaveBeenCalled();
    });

    it("recognizes an HTTPS endpoint case-insensitively", async () => {
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());
        const connect = vi.spyOn(client.client, "connect").mockResolvedValue({} as NativeGrpcChannel);

        await client.connect({
            protocol: "V3_GRPC",
            endpoint: "HTTPS://hyper.example.com:443",
            tls: { clientKeyPath: "", clientCertPath: "", caCertsPath: "" },
        }, fakeConnection);

        expect(connect).toHaveBeenCalledWith({
            endpoint: "HTTPS://hyper.example.com:443",
            tls: { keyPath: "", pubPath: "", caPath: "" },
        }, fakeConnection);
    });

    it("fails to create a channel with invalid foundations URL", async () => {
        const testChannelArgs = ({
            endpoint: "http://localhost:8080"
        }) as connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("not-dashql-native://localhost")
        }, logger);
        await expect(client.connect(testChannelArgs, fakeConnection)).rejects.toThrow();
    });

    it("can start a streaming gRPC call", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = ({
            endpoint: server.endpoint!
        }) as connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);

        const channel = await client.connect(testChannelArgs, fakeConnection);
        expect(channel.grpcChannel.channelId).not.toBeNull();
        expect(channel.grpcChannel.channelId).not.toBeNaN();

        server.executeQueryHandler = async () => ({
            messages: [
                buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$)
            ],
        });

        const params = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        }) as pb.salesforce_hyperdb_grpc_v1.pb.QueryParam;
        await channel.executeQuery(params);
        expect(server.executeQueryRequests).toHaveLength(1);
        expect(server.executeQueryRequests[0].query).toEqual("select 1");
        await server.close();
    });

    it("forwards gRPC metadata to Hyper", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, new TestLogger());
        const connectionWithMetadata: HyperDatabaseConnectionContext = {
            getAttachedDatabases: () => [],
            getRequestMetadata: () => Promise.resolve({ "ctx-tenant-id": "tenant-123" }),
            getQueryParameters: () => ({}),
        };
        const channel = await client.connect({
            protocol: "V3_GRPC",
            endpoint: server.endpoint!,
            tls: { clientKeyPath: "", clientCertPath: "", caCertsPath: "" },
        }, connectionWithMetadata);
        server.executeQueryHandler = async () => ({
            messages: [buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$)],
        });

        await channel.executeQuery(buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1",
        }));

        expect(server.executeQueryHeaders).toHaveLength(1);
        expect(server.executeQueryHeaders[0]["ctx-tenant-id"]).toBe("tenant-123");
        await channel.close();
        await server.close();
    });

    it("forwards query parameters from the connection context", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = ({
            endpoint: server.endpoint!
        }) as connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);

        const contextWithParams: HyperDatabaseConnectionContext = {
            getAttachedDatabases: () => [],
            getRequestMetadata: () => Promise.resolve({}),
            getQueryParameters: () => ({ lc_time: "de_DE", time_zone: "UTC" }),
        };

        const channel = await client.connect(testChannelArgs, contextWithParams);
        server.executeQueryHandler = async () => ({
            messages: [
                buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$)
            ],
        });

        const params = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        }) as pb.salesforce_hyperdb_grpc_v1.pb.QueryParam;
        await channel.executeQuery(params);
        expect(server.executeQueryRequests).toHaveLength(1);
        expect(server.executeQueryRequests[0].params).toEqual({ lc_time: "de_DE", time_zone: "UTC" });
        await server.close();
    });

    it("can read form a gRPC output stream", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = ({
            endpoint: server.endpoint!
        }) as connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);

        const channel = await client.connect(testChannelArgs, fakeConnection);
        expect(channel.grpcChannel.channelId).not.toBeNull();
        expect(channel.grpcChannel.channelId).not.toBeNaN();

        const headerMessage = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$, {
            result: {
                case: "header",
                value: buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultHeaderSchema, {
                    header: {
                        case: "schema",
                        value: buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchemaSchema, {
                            column: []
                        })
                    }
                }),
            }
        });
        const bodyMessage = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$, {
            result: {
                case: "arrowChunk",
                value: buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryBinaryResultChunkSchema, {
                    data: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
                }),
            }
        });

        server.executeQueryHandler = async () => ({
            messages: [headerMessage, bodyMessage],
        });

        const params = buf.create(pb.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        }) as pb.salesforce_hyperdb_grpc_v1.pb.QueryParam;
        const stream = await channel.executeQuery(params) as NativeHyperQueryResultStream;
        expect(server.executeQueryRequests).toHaveLength(1);
        expect(server.executeQueryRequests[0].query).toEqual("select 1");
        expect(stream.resultReader.grpcStream.streamId).not.toBeNull();
        expect(stream.resultReader.grpcStream.streamId).not.toBeNaN();

        const result = await stream.resultReader.grpcStream.next();
        expect(result.done).not.toBeTruthy();
        const value = result.value;
        expect(value).not.toBeNull();

        const next = await stream.resultReader.grpcStream.next();
        expect(next.done).toBeTruthy();
        await server.close();
    });
});
