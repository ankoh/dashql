import { vi } from 'vitest';

import { NativeAPIRustBridge } from '../native_api_rust_bridge.js';
import { getUnusedLocalEndpoint, TestHttpServer } from '../native_proxy_test_servers.js';
import { TestLogger } from '../logger/test_logger.js';
import { NativeHttpClient } from './native_http_client.js';

describe('Native HTTP client', () => {
    let bridge: NativeAPIRustBridge;
    beforeEach(() => {
        bridge = new NativeAPIRustBridge();
        vi.spyOn(globalThis, 'fetch').mockImplementation((req) => bridge.process(req as Request));
    });
    afterEach(() => {
        vi.restoreAllMocks();
        bridge.close();
    });

    it("fails when no mock is registered", async () => {
        const endpoint = await getUnusedLocalEndpoint();
        const logger = new TestLogger();
        const client = new NativeHttpClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        const url = new URL(`${endpoint}/foo/bar`);
        const response = await client.fetch(url, {
            method: "POST",
        });
        expect(response.status).toEqual(200);
        await expect(response.arrayBuffer()).rejects.toThrow('http request failed');
    });

    it("reads from an HTTP output stream", async () => {
        const server = new TestHttpServer();
        await server.start();
        server.handler = async (request, response) => {
            expect(request.method).toEqual('POST');
            expect(request.path).toEqual('/foo/bar');
            response.statusCode = 200;
            response.setHeader('some-server-metadata', 'some-value');
            response.write(Buffer.from([1, 2, 3, 4]));
            response.write(Buffer.from([5, 6, 7, 8]));
            response.end(Buffer.from([9, 10, 11, 12]));
        };

        const logger = new TestLogger();
        const client = new NativeHttpClient({
            proxyEndpoint: new URL("dashql-native://localhost")
        }, logger);
        const url = new URL(`/foo/bar`, server.endpoint!);

        const response = await client.fetch(url, {
            method: "POST",
        });
        expect(response.status).toEqual(200);

        const buffer = await response.arrayBuffer();
        expect(server.requests).toHaveLength(1);
        expect(new Uint8Array(buffer)).toEqual(new Uint8Array([
            1, 2, 3, 4,
            5, 6, 7, 8,
            9, 10, 11, 12,
        ]));
        await server.close();
    });
});

