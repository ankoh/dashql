import { Murmur3_x86_128 } from './hash_murmur3.js';

describe('Murmur3_128', () => {
    // https://github.com/PeterScott/murmur3/blob/master/test.c
    // https://github.com/m2osw/murmur3/blob/main/tests/catch_basic.cpp
    it("examples", () => {
        expect(Murmur3_x86_128.withSeed(123, true).add("Hello, world!").asString()).toEqual("61c9129e5a1aacd7a41621629e37c886");
        expect(Murmur3_x86_128.withSeed(321, true).add("Hello, world!").asString()).toEqual("d5fbdcb3c26c4193045880c5a7170f0f");
        expect(Murmur3_x86_128.withSeed(123, true).add("xxxxxxxxxxxxxxxxxxxxxxxxxxxx").asString()).toEqual("5e40bab278825a164cf929d31fec6047");
        expect(Murmur3_x86_128.withSeed(123, true).add("").asString()).toEqual("fedc524526f3e79926f3e79926f3e799");
    });
});
