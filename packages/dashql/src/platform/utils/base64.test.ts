import type * as app_event from '@akohn/dashql-jsonschema/app_event.js';

import { BASE64URL_CODEC, fromBase64, toBase64 } from "./base64.js";

/// 32 words of a seeded generator (mulberry32)
function randomBuffer32(seed: number): ArrayBuffer {
    const out = new Uint32Array(32);
    let state = seed >>> 0;
    for (let i = 0; i < out.length; ++i) {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        out[i] = (t ^ (t >>> 14)) >>> 0;
    }
    return out.buffer;
}

describe('toBase64 and fromBase64', () => {
    it("encode the test vectors of RFC 4648", () => {
        const vectors = ['', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy'];
        vectors.forEach((vector, i) => {
            const bytes = new TextEncoder().encode('foobar'.slice(0, i));
            expect(toBase64(bytes)).toBe(vector);
            expect(fromBase64(vector)).toEqual(bytes);
        });
    });

    it("roundtrip bytes beyond a chunk of String.fromCharCode", () => {
        const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xFF);
        expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    });

    describe("roundtrip random 32 byte sequences", () => {
        for (let i = 0; i < 1000; ++i) {
            it(`seed=${i}`, () => {
                const randomBytes = new Uint8Array(randomBuffer32(i));
                expect(fromBase64(toBase64(randomBytes))).toEqual(randomBytes);
            });
        }
    });
});

describe('BASE64URL_CODEC oauth event roundtrip', () => {
    const INSTANCE_URL = "https://trialorgfarmforu-16f.test2.my.pc-rnd.salesforce.com";
    const CONSUMER_KEY = "3MVG9GS4BiwvuHvgBoJxvy6gBq99_Ptg8FHx1QqO0bcDgy3lYc3x1b3nLPXGDQzYlYYMOwqo_j12QdTgAvAZD";

    // Use a range of timestamps so the encoded JSON hits all four base64 remainder lengths (% 4 == 0..3)
    const timestamps = [1777316266148, 1777316266149, 1777316266150, 1777316266151];

    for (const ts of timestamps) {
        it(`roundtrip with timestamp ${ts}`, () => {
            const event: app_event.AppEventData = {
                oauthRedirect: {
                    code: "auth_code_abc123",
                    state: {
                        flowId: `flow-${ts}`,
                        flowVariant: "WEB_OPENER_FLOW",
                        debugMode: false,
                        salesforceProvider: {
                            instanceUrl: INSTANCE_URL,
                            appConsumerKey: CONSUMER_KEY,
                            requestedAt: ts,
                            expiresAt: ts + 7200000,
                        }
                    }
                }
            };
            const json = JSON.stringify(event);
            const encoded = BASE64URL_CODEC.encode(new TextEncoder().encode(json).buffer);
            expect(BASE64URL_CODEC.isValidBase64(encoded)).toBeTruthy();
            const decoded = new TextDecoder().decode(BASE64URL_CODEC.decode(encoded));
            expect(JSON.parse(decoded)).toEqual(event);
        });
    }
});

describe('BASE64URL_CODEC', () => {
    describe("invalid base64url strings", () => {
        it("padding chars", () => {
            expect(BASE64URL_CODEC.isValidBase64("uny100A")).toBeTruthy();
            expect(BASE64URL_CODEC.isValidBase64("uny100")).toBeTruthy();

            expect(BASE64URL_CODEC.isValidBase64("uny100A=")).toBeFalsy();
            expect(BASE64URL_CODEC.isValidBase64("uny100==")).toBeFalsy();
            expect(BASE64URL_CODEC.isValidBase64("=uny100=")).toBeFalsy();
            expect(BASE64URL_CODEC.isValidBase64("==uny100")).toBeFalsy();
        })
    });

    describe("encodes random 32 byte sequences", () => {
        for (let i = 0; i < 1000; ++i) {
            it(`seed=${i}`, () => {
                const randomBytes = randomBuffer32(i)
                const encoded = BASE64URL_CODEC.encode(randomBytes);
                expect(BASE64URL_CODEC.isValidBase64(encoded)).toBeTruthy();
                const decoded = BASE64URL_CODEC.decode(encoded);
                expect(decoded).toEqual(randomBytes);
            });
        }
    });
});
