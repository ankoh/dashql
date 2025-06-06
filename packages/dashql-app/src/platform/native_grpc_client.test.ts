import { jest } from '@jest/globals';

import * as proto from "@ankoh/dashql-protobuf";
import * as buf from "@bufbuild/protobuf";

import { GrpcServerStream, NativeAPIMock } from './native_api_mock.js';
import { NativeGrpcClient, NativeGrpcServerStreamBatchEvent } from './native_grpc_client.js';
import { ChannelArgs, ChannelMetadataProvider } from './channel_common.js';
import { PlatformType } from './platform_type.js';
import { TestLogger } from './test_logger.js';

describe('Native gRPC client', () => {
    let mock: NativeAPIMock | null;
    beforeEach(() => {
        mock = new NativeAPIMock(PlatformType.MACOS);
        jest.spyOn(global, 'fetch').mockImplementation((req) => mock!.process(req as Request));
    });
    afterEach(() => {
        (global.fetch as jest.Mock).mockRestore();
    });
    const testChannelArgs: ChannelArgs = {
        endpoint: "http://localhost:8080"
    };
    const fakeMetadataProvider: ChannelMetadataProvider = {
        getRequestMetadata(): Promise<Record<string, string>> {
            return Promise.resolve({});
        }
    };

    // Test channel creation
    it("can create a channel", () => {
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        expect(async () => await client.connect(testChannelArgs, fakeMetadataProvider)).resolves;
    });
    // Make sure channel creation fails with wrong foundations url
    it("fails to create a channel with invalid foundations URL", () => {
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("not-dashql-native://localhost")
        }, logger);
        expect(async () => await client.connect(testChannelArgs, fakeMetadataProvider)).rejects.toThrow();
    });

    // Test starting a server stream
    it("starts a streaming gRPC call", async () => {
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);

        // Setup the channel
        const channel = await client.connect(testChannelArgs, fakeMetadataProvider);
        expect(channel.channelId).not.toBeNull();
        expect(channel.channelId).not.toBeNaN();

        // Mock executeQuery call
        const executeQueryMock = jest.fn((_query: string) => new GrpcServerStream(200, "OK", {}, [
            {
                event: NativeGrpcServerStreamBatchEvent.FlushAfterClose,
                messages: [
                    buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryResultSchema$)
                ],
            }
        ]));
        mock!.hyperService.executeQuery = (p) => executeQueryMock(p.query);

        // Start the server stream
        const params = buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        });
        await channel.startServerStream({
            path: "/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery",
            body: buf.toBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, params),
        });
        expect(executeQueryMock).toHaveBeenCalled();
        expect(executeQueryMock).toHaveBeenCalledWith("select 1");
    });

    // Test reading from a server stream
    it("reads from a gRPC output stream", async () => {
        const logger = new TestLogger();
        const client = new NativeGrpcClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);

        // Setup the channel
        const channel = await client.connect(testChannelArgs, fakeMetadataProvider);
        expect(channel.channelId).not.toBeNull();
        expect(channel.channelId).not.toBeNaN();

        // Build the first message that is returned to the client (in this test a header message)
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

        // Mock executeQuery call
        const executeQueryMock = jest.fn((_query: string) => new GrpcServerStream(200, "OK", {}, [
            {
                event: NativeGrpcServerStreamBatchEvent.FlushAfterClose,
                messages: [headerMessage],
            }
        ]));
        mock!.hyperService.executeQuery = (p) => executeQueryMock(p.query);

        // Start the server stream
        const params = buf.create(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, {
            query: "select 1"
        });
        const stream = await channel.startServerStream({
            path: "/salesforce.hyperdb.grpc.v1.HyperService/ExecuteQuery",
            body: buf.toBinary(proto.salesforce_hyperdb_grpc_v1.pb.QueryParamSchema, params)
        });
        expect(executeQueryMock).toHaveBeenCalled();
        expect(executeQueryMock).toHaveBeenCalledWith("select 1");
        expect(stream.streamId).not.toBeNull();
        expect(stream.streamId).not.toBeNaN();

        // Read a message from the result stream
        const result = await stream.read();
        expect(result).not.toBeNull();
        expect(result.event).toEqual(NativeGrpcServerStreamBatchEvent.FlushAfterClose);
        expect(result.messages.length).toEqual(1);

        // The stream should get cleaned up after the last read.
        // The client is expected to understand that "FlushAfterClose" hints at the stream being closed now.
        // Subsequent reads will fail.
        expect(stream.read()).rejects.toThrow(new Error("stream not found"));

    });
});
