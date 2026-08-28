import path from "node:path";

import {describe, expect, it} from "vitest";

import {APP_RESPONSE_HEADERS, contentHeadersFor, contentTypeFor, isBrotliWasm, resolveAppRequest} from "./app_protocol.js";

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
