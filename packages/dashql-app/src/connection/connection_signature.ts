import { Hasher } from "../utils/hash.js";

export type ConnectionSignatureMap = Map<string, number | null>;

export interface ConnectionSignatureState {
    /// The seed derived from the connection
    hash: Hasher;
    /// The connection signature string.
    /// Hex encoded buffer derived from the connection hash.
    signatureString: string;
    /// The shared map to dedup connection signature strings.
    /// Note that this set can never be used for change-detection since it shared on-construction with every state.
    /// We use this set to make sure that a connection signature is unique.
    signatures: Map<string, number | null>;
}

const SIGNATURE_DEFAULT_LENGTH = 6;
const HEX_TABLE = "0123456789abcdef";

export function updateConnectionSignature(prev: ConnectionSignatureState, next: Hasher, connectionId: number | null): ConnectionSignatureState {
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
            prev.signatures.set(sig, connectionId);
            return {
                hash: next,
                signatureString: sig,
                signatures: prev.signatures,
            }
        } else {
            sig += HEX_TABLE[Math.floor(rng.next() * HEX_TABLE.length)];
        }
    }
}

export function newConnectionSignature(seed: Hasher, sigs: ConnectionSignatureMap, connectionId: number | null) {
    const state: ConnectionSignatureState = {
        hash: seed,
        signatureString: "",
        signatures: sigs
    };
    return updateConnectionSignature(state, seed, connectionId);
}
