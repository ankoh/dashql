import * as flatbuffers from 'flatbuffers';

import type { FlatBuffer } from './wasm/dashql_core.js';

/// The packed FlatBuffers of the views of the module (docs/wip/runtime_projection.md). A view carries a payload as the
/// bytes of a FlatBuffer, typed by the table at its root, with a key that names it. The host reads the payload with the
/// generated accessors, which read the bytes in place, and keeps the accessor object while the key doesn't move. The
/// host tells the module the key it holds, the module leaves the bytes of that key out.

export type { FlatBuffer } from './wasm/dashql_core.js';

/// The root table of a FlatBuffer, read in place
export function readFlatBuffer<T>(bytes: FlatBuffer<T>, root: (bb: flatbuffers.ByteBuffer) => T): T {
    return root(new flatbuffers.ByteBuffer(bytes));
}

/// The payloads of a kind by slot, e.g. the editor updates by script. A payload keeps its accessor object while its
/// key doesn't move.
export class FlatBufferCache<T> {
    private readonly entries = new Map<string | number, { key: string; table: T }>();

    constructor(private readonly root: (bb: flatbuffers.ByteBuffer) => T) {}

    /// The key of the payload that the cache holds for a slot, the module leaves the bytes of this key out
    known(slot: string | number): string | null {
        return this.entries.get(slot)?.key ?? null;
    }

    /// The payload of a slot: the held one while the key is the same, else the one of the bytes. Null without a key.
    read(slot: string | number, key: string | null, bytes: FlatBuffer<T> | null): T | null {
        if (key == null) {
            this.entries.delete(slot);
            return null;
        }
        const held = this.entries.get(slot);
        if (held != null && held.key === key) return held.table;
        if (bytes == null) return null;
        const table = readFlatBuffer(bytes, this.root);
        this.entries.set(slot, { key, table });
        return table;
    }

    /// Forget the slots that are not in the list
    retain(slots: Iterable<string | number>): void {
        const keep = new Set(slots);
        for (const slot of [...this.entries.keys()]) {
            if (!keep.has(slot)) this.entries.delete(slot);
        }
    }
}
