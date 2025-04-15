import { BASE64_TABLE_URL } from "../utils/base64.js";
import { Hasher } from "../utils/hash.js";

export type ConnectionSignatures = Set<string>;

export interface ConnectionSignatureState {
    /// The seed derived from the connection
    hash: Hasher;
    /// The connection signature string.
    /// Base64 encoded buffer derived from the seed.
    signatureString: string;
    /// The shared map to dedup connection signature strings.
    /// Note that this set can never be used for change-detection since it shared on-construction with every state.
    /// We use this set to make sure that a connection signature is unique.
    signatures: Set<string>;
}

const SIGNATURE_DEFAULT_LENGTH = 6;
const HEX_TABLE = "0123456789abcdef";

export function updateConnectionSignature(prev: ConnectionSignatureState, next: Hasher): ConnectionSignatureState {
    const rng = next.asPrng();

    // Remove the old one
    if (prev.signatureString != "") {
        prev.signatures.delete(prev.signatureString);
    }

    // Fill default length
    let sig = "";
    for (let i = 0; i < SIGNATURE_DEFAULT_LENGTH; ++i) {
        sig += HEX_TABLE[Math.floor(rng.next() * HEX_TABLE.length)];
    }

    // Fill more characters
    while (true) {
        if (!prev.signatures.has(sig)) {
            prev.signatures.add(sig);
            return {
                hash: next,
                signatureString: sig,
                signatures: prev.signatures,
            }
        } else {
            sig += BASE64_TABLE_URL[Math.floor(rng.next() * BASE64_TABLE_URL.length)];
        }
    }
}

export function newConnectionSignature(seed: Hasher, sigs: ConnectionSignatures) {
    const state: ConnectionSignatureState = {
        hash: seed,
        signatureString: "",
        signatures: sigs
    };
    return updateConnectionSignature(state, seed);
}
