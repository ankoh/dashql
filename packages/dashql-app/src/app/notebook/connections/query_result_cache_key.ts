/// Computes the content hash that keys a query result in the file-based query result cache.
///
/// A result is cached as a pure function of `(connection params signature, query text)`: the same
/// query text against a connection with the same structural signature yields the same bytes, so the
/// SHA-256 of those two inputs is the cache key. Post-processing (analyze/UMAP projection) runs after
/// the cache load, so it deliberately does NOT participate in the key.

/// Deterministically serialize a value to JSON with object keys sorted at every level.
///
/// `createConnectionParamsSignature` already sorts its arrays, but `JSON.stringify` preserves object
/// *key insertion order*, which is not guaranteed stable across constructions. The whole cache's
/// correctness rests on a byte-stable canonical form, so we sort keys explicitly here.
function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const sorted: Record<string, unknown> = {};
            for (const k of Object.keys(val as Record<string, unknown>).sort()) {
                sorted[k] = (val as Record<string, unknown>)[k];
            }
            return sorted;
        }
        return val;
    });
}

/// Hex-encode a byte buffer (lowercase).
function toHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; ++i) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

/// Compute the lowercase SHA-256 hex digest of the canonical connection signature plus the query
/// text. The two inputs are separated by a newline so distinct (signature, query) pairs cannot
/// collide by concatenation.
export async function computeQueryResultCacheKey(paramsSignature: unknown, queryText: string): Promise<string> {
    const input = `${stableStringify(paramsSignature)}\n${queryText}`;
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return toHex(digest);
}
