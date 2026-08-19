import { B3_SPAN_ID_HEADER, B3_TRACE_ID_HEADER, B3TraceHttpClient, HttpClient, HttpFetchResult } from './http_client.js';

class RecordingHttpClient implements HttpClient {
    input: URL | Request | string | null = null;
    init: RequestInit | null = null;

    async fetch(input: URL | Request | string, init?: RequestInit): Promise<HttpFetchResult> {
        this.input = input;
        this.init = init ?? null;
        return {} as HttpFetchResult;
    }
}

describe('Http Client', () => {
    it("adds B3 trace and span ids and preserves request headers", async () => {
        const inner = new RecordingHttpClient();
        const client = new B3TraceHttpClient(inner);

        await client.fetch(new Request("https://example.com", {
            headers: { "from-request": "request-value" },
        }), {
            headers: { "from-init": "init-value" },
        });

        const headers = new Headers(inner.init?.headers);
        expect(headers.get("from-request")).toEqual("request-value");
        expect(headers.get("from-init")).toEqual("init-value");
        expect(headers.get(B3_TRACE_ID_HEADER)).toMatch(/^[0-9a-f]{32}$/);
        expect(headers.get(B3_SPAN_ID_HEADER)).toMatch(/^[0-9a-f]{16}$/);
    });

    it("preserves caller-provided B3 trace and span ids", async () => {
        const inner = new RecordingHttpClient();
        const client = new B3TraceHttpClient(inner);
        const traceId = "0123456789abcdef0123456789abcdef";
        const spanId = "0123456789abcdef";

        await client.fetch("https://example.com", {
            headers: {
                [B3_TRACE_ID_HEADER]: traceId,
                [B3_SPAN_ID_HEADER]: spanId,
            },
        });

        const headers = new Headers(inner.init?.headers);
        expect(headers.get(B3_TRACE_ID_HEADER)).toEqual(traceId);
        expect(headers.get(B3_SPAN_ID_HEADER)).toEqual(spanId);
    });

    it("Request.arrayBuffer equals manual UTF-8 encoding", async () => {
        const urlParams = new URLSearchParams();
        urlParams.set("grant_type", "authorization_code");
        urlParams.set("code", "foo");
        urlParams.set("redirect_uri", "http://localhost:9002/oauth.html");
        const request = new Request("http://localhost:9003", {
            method: 'POST',
            headers: new Headers({
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            }),
            body: urlParams,
        });
        const buffer = await request.arrayBuffer();

        const body = (new URLSearchParams(urlParams)).toString();
        const manualUTF8 = (new TextEncoder()).encode(body);

        expect(buffer.byteLength).toEqual(94);
        expect(buffer.byteLength).toEqual(manualUTF8.byteLength);
        expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(manualUTF8));
    });
});
