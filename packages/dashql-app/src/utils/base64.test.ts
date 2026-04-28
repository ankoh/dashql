import * as auth from '@ankoh/dashql-jsonschema/auth.js';

import type * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import { BASE64_CODEC, BASE64URL_CODEC } from "./base64.js";
import { randomBuffer32 } from "./hash.js";
import { DefaultHasher } from './hash_default.js';

describe('Base64Codec', () => {
    describe("invalid base64 strings", () => {
        it("padding chars", () => {
            expect(BASE64_CODEC.isValidBase64("uny100A=")).toBeTruthy();
            expect(BASE64_CODEC.isValidBase64("uny100==")).toBeTruthy();
            expect(BASE64_CODEC.isValidBase64("=uny100=")).toBeFalsy();
            expect(BASE64_CODEC.isValidBase64("==uny100")).toBeFalsy();
        })
    });

    describe("encodes random 32 byte sequences", () => {
        for (let i = 0; i < 1000; ++i) {
            it(`seed=${i}`, () => {
                const randomBytes = randomBuffer32(32, DefaultHasher.hash(i.toString()).asPrng())
                const encoded = BASE64_CODEC.encode(randomBytes);
                expect(BASE64_CODEC.isValidBase64(encoded)).toBeTruthy();
                const decoded = BASE64_CODEC.decode(encoded);
                expect(decoded).toEqual(randomBytes);
            });
        }
    });

    it("encode salesforce oauth web flow state", () => {
        const authState: auth.OAuthState = {
            flowVariant: "WEB_OPENER_FLOW",
            debugMode: false,
            salesforceProvider: {
                instanceUrl: "https://trialorgfarmforu-16f.test2.my.pc-rnd.salesforce.com",
                appConsumerKey: "foo",
                requestedAt: 0,
                expiresAt: 0
            }
        };
        // Encode as JSON
        const authStateJson = JSON.stringify(authState);
        const authStateBuffer = new TextEncoder().encode(authStateJson);
        const authStateBase64 = BASE64_CODEC.encode(authStateBuffer.buffer);
        // Verify it encodes and decodes correctly
        const decoded = BASE64_CODEC.decode(authStateBase64);
        const decodedJson = new TextDecoder().decode(decoded);
        const decodedState = JSON.parse(decodedJson);
        expect(decodedState).toEqual(authState);
    });

    it("encode salesforce oauth native flow state", () => {
        const authState: auth.OAuthState = {
            flowVariant: "NATIVE_LINK_FLOW",
            debugMode: false,
            salesforceProvider: {
                instanceUrl: "https://trialorgfarmforu-16f.test2.my.pc-rnd.salesforce.com",
                appConsumerKey: "foo",
                requestedAt: 0,
                expiresAt: 0
            }
        };
        // Encode as JSON
        const authStateJson = JSON.stringify(authState);
        const authStateBuffer = new TextEncoder().encode(authStateJson);
        const authStateBase64 = BASE64_CODEC.encode(authStateBuffer.buffer);
        // Verify it encodes and decodes correctly
        const decoded = BASE64_CODEC.decode(authStateBase64);
        const decodedJson = new TextDecoder().decode(decoded);
        const decodedState = JSON.parse(decodedJson);
        expect(decodedState).toEqual(authState);
    });
});

describe('Base64UrlCodec oauth event roundtrip', () => {
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

describe('Base64UrlCodec', () => {
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
                const randomBytes = randomBuffer32(32, DefaultHasher.hash(i.toString()).asPrng())
                const encoded = BASE64URL_CODEC.encode(randomBytes);
                expect(BASE64URL_CODEC.isValidBase64(encoded)).toBeTruthy();
                const decoded = BASE64URL_CODEC.decode(encoded);
                expect(decoded).toEqual(randomBytes);
            });
        }
    });
});
