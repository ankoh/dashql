import { vi } from 'vitest';

import * as pb from "../proto.js";
import * as buf from "@bufbuild/protobuf";

import { NativeAPIRustBridge } from './native_api_rust_bridge.js';
import { TestHyperGrpcServer } from './native_proxy_test_servers.js';
import { NativeHyperDatabaseClient, NativeHyperQueryResultStream } from './native_hyperdb_client.js';
import { TestLogger } from './test_logger.js';
import { AttachedDatabase, HyperDatabaseConnectionContext } from '../connection/hyper/hyperdb_client.js';

describe('Native Hyper client', () => {
    let bridge: NativeAPIRustBridge;
    beforeEach(() => {
        bridge = new NativeAPIRustBridge();
        vi.spyOn(globalThis, 'fetch').mockImplementation((req) => bridge.process(req as Request));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        bridge.close();
    });
    const fakeConnection: HyperDatabaseConnectionContext = {
        getAttachedDatabases(): AttachedDatabase[] {
            return []
        },
        getRequestMetadata(): Promise<Record<string, string>> {
            return Promise.resolve({});
        }
    };

    it("can create a channel", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = buf.create(pb.dashql.connection.HyperConnectionParamsSchema, {
            endpoint: server.endpoint!
        }) as pb.dashql.connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        await expect(client.connect(testChannelArgs, fakeConnection)).resolves.toBeDefined();
        await server.close();
    });

    it("fails to create a channel with invalid foundations URL", async () => {
        const testChannelArgs = buf.create(pb.dashql.connection.HyperConnectionParamsSchema, {
            endpoint: "http://localhost:8080"
        }) as pb.dashql.connection.HyperConnectionParams;
        const logger = new TestLogger();
        const client = new NativeHyperDatabaseClient({
            proxyEndpoint: new URL("not-dashql-native://localhost")
        }, logger);
        await expect(client.connect(testChannelArgs, fakeConnection)).rejects.toThrow();
    });

    it("can start a streaming gRPC call", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = buf.create(pb.dashql.connection.HyperConnectionParamsSchema, {
            endpoint: server.endpoint!
        }) as pb.dashql.connection.HyperConnectionParams;
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

    it("can read form a gRPC output stream", async () => {
        const server = new TestHyperGrpcServer();
        await server.start();
        const testChannelArgs = buf.create(pb.dashql.connection.HyperConnectionParamsSchema, {
            endpoint: server.endpoint!
        }) as pb.dashql.connection.HyperConnectionParams;
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
