import { Hasher } from "../../utils/hash.js";

export function computeServerlessConnectionSignature(_details: {}, hasher: Hasher) {
    hasher.add("serverless");
}

