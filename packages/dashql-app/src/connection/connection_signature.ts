import { BASE64URL_CODEC } from "../utils/base64.js";
import { Cyrb128 } from "../utils/prng.js";

export type UniqueConnectionSignatures = Set<string>;

export interface ConnectionSignatureState {
    /// The seed derived from the connection
    seed: Cyrb128;
    /// The connection signature string.
    /// Base64 encoded buffer derived from the seed.
    signatureString: string;
    /// The shared map to dedup connection signature strings.
    /// Note that this set can never be used for change-detection since it shared on-construction with every state.
    /// We use this set to make sure that a connection signature is unique.
    uniqueSignatures: Set<string>;
}

const SIGNATURE_BUFFER_INITIAL_CAPACITY = 64;
const SIGNATURE_BUFFER_GROWTH_FACTOR = 1.25;
const SIGNATURE_DEFAULT_LENGTH = 6;

export function updateConnectionSignature(prev: ConnectionSignatureState, next: Cyrb128): ConnectionSignatureState {
    const rng = next.asSfc32();

    // Remove the old one
    if (prev.signatureString != "") {
        prev.uniqueSignatures.delete(prev.signatureString);
    }

    // Fill the minimum
    let buffer = new Uint8Array(SIGNATURE_BUFFER_INITIAL_CAPACITY);
    let length = SIGNATURE_DEFAULT_LENGTH;
    for (let i = 0; i < length; ++i) {
        buffer[i] = rng.next() * 0xFF;
    }

    while (true) {
        // Resize the signature buffer?
        if (length == buffer.length) {
            const resized = new Uint8Array(buffer.length * SIGNATURE_BUFFER_GROWTH_FACTOR);
            resized.set(buffer);
            buffer = resized;
        }

        // Convert to base64
        const sig = BASE64URL_CODEC.encode(buffer.buffer.slice(0, length));
        // Unique?
        if (!prev.uniqueSignatures.has(sig)) {
            prev.uniqueSignatures.add(sig);
            return {
                seed: next,
                signatureString: sig,
                uniqueSignatures: prev.uniqueSignatures,
            }
        } else {
            buffer[length++] = rng.next() * 0xFF;
        }
    }
}

export function newConnectionSignature(seed: Cyrb128, sigs: UniqueConnectionSignatures) {
    const state: ConnectionSignatureState = {
        seed,
        signatureString: "",
        uniqueSignatures: sigs
    };
    return updateConnectionSignature(state, seed);
}
