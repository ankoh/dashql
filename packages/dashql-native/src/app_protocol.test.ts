import path from "node:path";

import {describe, expect, it} from "vitest";

import {APP_RESPONSE_HEADERS, contentHeadersFor, contentTypeFor, isBrotliWasm, isTrustedRendererUrl, parseRendererDevOrigin, resolveAppRequest} from "./app_protocol.js";

describe("renderer development origin", () => {
    it("accepts loopback HTTP origins", () => {
        expect(parseRendererDevOrigin("http://localhost:9002")).toBe("http://localhost:9002");
        expect(parseRendererDevOrigin("http://127.0.0.1:9002")).toBe("http://127.0.0.1:9002");
    });

    it.each([
        "https://localhost:9002",
        "http://example.com:9002",
        "http://user@localhost:9002",
        "http://localhost:9002/app",
    ])("rejects an unsafe development URL: %s", (url) => {
        expect(() => parseRendererDevOrigin(url)).toThrow("Invalid Electron renderer development URL");
    });

    it("trusts only the packaged origin and configured development origin", () => {
        const devOrigin = parseRendererDevOrigin("http://localhost:9002");
        expect(isTrustedRendererUrl("app://bundle/index.html", devOrigin)).toBe(true);
        expect(isTrustedRendererUrl("http://localhost:9002/src/app.tsx", devOrigin)).toBe(true);
        expect(isTrustedRendererUrl("app://other/index.html", devOrigin)).toBe(false);
        expect(isTrustedRendererUrl("http://localhost:9003/index.html", devOrigin)).toBe(false);
        expect(isTrustedRendererUrl("http://localhost:9002.evil.test/index.html", devOrigin)).toBe(false);
    });
});

describe("resolveAppRequest", () => {
    const rendererRoot = path.resolve("/tmp/dashql-renderer");

    it("maps the origin root to index.html", () => {
        expect(resolveAppRequest(rendererRoot, "app://bundle/")).toBe(path.join(rendererRoot, "index.html"));
    });

    it("maps packaged assets below the renderer root", () => {
        expect(resolveAppRequest(rendererRoot, "app://bundle/static/app.js")).toBe(
            path.join(rendererRoot, "static/app.js"),
        );
    });

    it.each([
        "https://bundle/index.html",
        "app://other/index.html",
        "app://user@bundle/index.html",
        "app://bundle/%E0%A4%A",
        "app://bundle/static%5C..%5Csecret",
        "app://bundle/%00secret",
    ])("rejects an invalid application URL: %s", (url) => {
        expect(resolveAppRequest(rendererRoot, url)).toBeNull();
    });
});

describe("application responses", () => {
    it("declares the headers required for cross-origin isolation", () => {
        expect(APP_RESPONSE_HEADERS["Cross-Origin-Opener-Policy"]).toBe("same-origin");
        expect(APP_RESPONSE_HEADERS["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
        expect(APP_RESPONSE_HEADERS["Content-Security-Policy"]).toContain("script-src 'self' 'wasm-unsafe-eval' blob:");
    });

    it("serves Wasm with the streaming compilation MIME type", () => {
        expect(contentTypeFor("hyperdb.wasm")).toBe("application/wasm");
    });

    it("identifies and serves decoded precompressed HyperDB Wasm as Wasm", () => {
        expect(contentHeadersFor("hyperdb-wasm.wasm.4KUbMLge.br")).toEqual({
            "Content-Type": "application/wasm",
        });
        expect(isBrotliWasm("hyperdb-wasm.wasm.4KUbMLge.br")).toBe(true);
        expect(isBrotliWasm("app.js.br")).toBe(false);
    });
});
