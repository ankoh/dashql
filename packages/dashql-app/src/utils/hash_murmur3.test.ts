import { Murmur3_128 } from './hash_murmur3.js';

describe('Murmur3_128', () => {
    it("hashes", () => {
        expect(Murmur3_128.withSeed(128).add("Hello, world!").asString()).toEqual("a548a5a0a6ab7834b355131677149730");
    });
});
