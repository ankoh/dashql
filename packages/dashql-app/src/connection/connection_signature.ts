import { BASE64_TABLE_URL } from "../utils/base64.js";
import { Hasher } from "../utils/prng.js";

export type UniqueConnectionSignatures = Set<string>;

export interface ConnectionSignatureState {
    /// The seed derived from the connection
    seed: Hasher;
    /// The connection signature string.
    /// Base64 encoded buffer derived from the seed.
    signatureString: string;
    /// The shared map to dedup connection signature strings.
    /// Note that this set can never be used for change-detection since it shared on-construction with every state.
    /// We use this set to make sure that a connection signature is unique.
    uniqueSignatures: Set<string>;
}

const SIGNATURE_DEFAULT_LENGTH = 6;

export function updateConnectionSignature(prev: ConnectionSignatureState, next: Hasher): ConnectionSignatureState {
    const rng = next.asPrng();

    // Remove the old one
    if (prev.signatureString != "") {
        prev.uniqueSignatures.delete(prev.signatureString);
    }

    // Fill default length
    let sig = "";
    for (let i = 0; i < SIGNATURE_DEFAULT_LENGTH; ++i) {
        sig += BASE64_TABLE_URL[Math.floor(rng.next() * BASE64_TABLE_URL.length)];
    }

    // Fill more characters
    while (true) {
        if (!prev.uniqueSignatures.has(sig)) {
            prev.uniqueSignatures.add(sig);
            return {
                seed: next,
                signatureString: sig,
                uniqueSignatures: prev.uniqueSignatures,
            }
        } else {
            sig += BASE64_TABLE_URL[Math.floor(rng.next() * BASE64_TABLE_URL.length)];
        }
    }
}

export function newConnectionSignature(seed: Hasher, sigs: UniqueConnectionSignatures) {
    const state: ConnectionSignatureState = {
        seed,
        signatureString: "",
        uniqueSignatures: sigs
    };
    return updateConnectionSignature(state, seed);
}
