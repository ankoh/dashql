import {EventEmitter} from "node:events";

import {describe, expect, it, vi} from "vitest";

import {NativeProxyService, validateNativeProxyRequest} from "./native_proxy.js";

class FakeUtilityProcess extends EventEmitter {
    readonly sent: unknown[] = [];
    killed = false;

    postMessage(message: unknown): void {
        this.sent.push(message);
    }

    kill(): boolean {
        this.killed = true;
        return true;
    }
}

describe("NativeProxyService", () => {
    it("correlates responses that arrive out of order", async () => {
        const child = new FakeUtilityProcess();
        const service = new NativeProxyService(child as never);
        child.emit("message", {type: "ready"});
        await service.ready();

        const first = service.request({body: new Uint8Array([1]), headers: [], method: "GET", url: "dashql-native://localhost/http/stream/1"});
        const second = service.request({body: new Uint8Array([2]), headers: [], method: "GET", url: "dashql-native://localhost/http/stream/2"});
        await vi.waitFor(() => expect(child.sent).toHaveLength(2));
        const firstId = (child.sent[0] as {id: number}).id;
        const secondId = (child.sent[1] as {id: number}).id;
        child.emit("message", {body: new Uint8Array([2]), headers: [], id: secondId, status: 202, statusText: "Accepted"});
        child.emit("message", {body: new Uint8Array([1]), headers: [], id: firstId, status: 200, statusText: "OK"});

        expect((await first).status).toBe(200);
        expect((await second).status).toBe(202);
        service.close();
    });

    it("rejects pending requests when the utility process exits", async () => {
        const child = new FakeUtilityProcess();
        const service = new NativeProxyService(child as never);
        child.emit("message", {type: "ready"});
        await service.ready();
        const request = service.request({body: new Uint8Array(), headers: [], method: "GET", url: "dashql-native://localhost/http/stream/1"});
        await vi.waitFor(() => expect(child.sent).toHaveLength(1));
        child.emit("exit", 9);
        await expect(request).rejects.toThrow("exited with code 9");
    });
});

describe("validateNativeProxyRequest", () => {
    const validRequest = {
        body: new Uint8Array(),
        headers: [["dashql-endpoint", "https://example.com"]],
        method: "POST",
        url: "dashql-native://localhost/http/streams",
    };

    it("accepts a scoped native proxy request", () => {
        expect(() => validateNativeProxyRequest(validRequest)).not.toThrow();
    });

    it.each([
        {...validRequest, method: "CONNECT"},
        {...validRequest, url: "https://localhost/http/streams"},
        {...validRequest, url: "dashql-native://remote/http/streams"},
        {...validRequest, url: "dashql-native://localhost/duckdb/databases"},
        {...validRequest, url: "dashql-native://user@localhost/http/streams"},
    ])("rejects a request outside the native proxy surface", (request) => {
        expect(() => validateNativeProxyRequest(request)).toThrow("Rejected native proxy");
    });
});
