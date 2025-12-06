import { Hasher } from "../../utils/hash.js";

export function computeDatalessConnectionSignature(_details: {}, hasher: Hasher) {
    hasher.add("dataless");
}

