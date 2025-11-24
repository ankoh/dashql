import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

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
        const authState = buf.create(pb.dashql.auth.OAuthStateSchema, {
            flowVariant: pb.dashql.auth.OAuthFlowVariant.WEB_OPENER_FLOW,
            providerOptions: {
                case: "salesforceProvider",
                value: buf.create(pb.dashql.auth.SalesforceOAuthParamsSchema, {
                    instanceUrl: "https://trialorgfarmforu-16f.test2.my.pc-rnd.salesforce.com",
                    appConsumerKey: "foo",
                }),
            }
        });
        const authStateBuffer = buf.toBinary(pb.dashql.auth.OAuthStateSchema, authState);
        const authStateBase64 = BASE64_CODEC.encode(authStateBuffer.buffer);
        expect(authStateBase64).toEqual("EAEaQgo7aHR0cHM6Ly90cmlhbG9yZ2Zhcm1mb3J1LTE2Zi50ZXN0Mi5teS5wYy1ybmQuc2FsZXNmb3JjZS5jb20SA2Zvbw==");
    });

    it("encode salesforce oauth native flow state", () => {
        const authState = buf.create(pb.dashql.auth.OAuthStateSchema, {
            flowVariant: pb.dashql.auth.OAuthFlowVariant.NATIVE_LINK_FLOW,
            providerOptions: {
                case: "salesforceProvider",
                value: buf.create(pb.dashql.auth.SalesforceOAuthParamsSchema, {
                    instanceUrl: "https://trialorgfarmforu-16f.test2.my.pc-rnd.salesforce.com",
                    appConsumerKey: "foo"
                }),
            }
        });
        const authStateBuffer = buf.toBinary(pb.dashql.auth.OAuthStateSchema, authState);
        const authStateBase64 = BASE64_CODEC.encode(authStateBuffer.buffer);
        expect(authStateBase64).toEqual("EAIaQgo7aHR0cHM6Ly90cmlhbG9yZ2Zhcm1mb3J1LTE2Zi50ZXN0Mi5teS5wYy1ybmQuc2FsZXNmb3JjZS5jb20SA2Zvbw==");
    });
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
