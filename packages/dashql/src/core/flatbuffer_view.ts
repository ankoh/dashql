import * as flatbuffers from 'flatbuffers';

import type { FlatBuffer } from '@ankoh/dashql-wasm/dashql_core.js';

/// The packed FlatBuffers of the views of the module (docs/wip/runtime_projection.md). A view carries a payload as the
/// bytes of a FlatBuffer, typed by the table at its root, with a key that names it. The host reads the payload with the
/// generated accessors, which read the bytes in place, and keeps the accessor object while the key doesn't move. The
/// host tells the module the key it holds, the module leaves the bytes of that key out.

export type { FlatBuffer } from '@ankoh/dashql-wasm/dashql_core.js';

/// The root table of a FlatBuffer, read in place
export function readFlatBuffer<T>(bytes: FlatBuffer<T>, root: (bb: flatbuffers.ByteBuffer) => T): T {
    return root(new flatbuffers.ByteBuffer(bytes));
}

/// The payloads of a kind by slot, e.g. the editor updates by script. A payload keeps its object while its key doesn't
/// move: the accessor object of its root table `T`, or what `hydrate` made of it, e.g. the object API of the table
/// while the consumers read that. A key is a string, e.g. the key of an editor update, or a number, e.g. a revision.
export class FlatBufferCache<T, V = T, K extends string | number = string> {
    private readonly entries = new Map<string | number, { key: K; value: V }>();

    constructor(
        private readonly root: (bb: flatbuffers.ByteBuffer) => T,
        private readonly hydrate: (table: T, bytes: FlatBuffer<T>) => V = table => table as unknown as V,
    ) {}

    /// The key of the payload that the cache holds for a slot, the module leaves the bytes of this key out
    known(slot: string | number): K | null {
        return this.entries.get(slot)?.key ?? null;
    }

    /// Hold a payload that the host has already, e.g. the editor update that an editor reported
    hold(slot: string | number, key: K, value: V): void {
        this.entries.set(slot, { key, value });
    }

    /// The payload of a slot: the held one while the key is the same, else the one of the bytes. Null without a key.
    read(slot: string | number, key: K | null, bytes: FlatBuffer<T> | null): V | null {
        if (key == null) {
            this.entries.delete(slot);
            return null;
        }
        const held = this.entries.get(slot);
        if (held != null && held.key === key) return held.value;
        if (bytes == null) return null;
        const value = this.hydrate(readFlatBuffer(bytes, this.root), bytes);
        this.entries.set(slot, { key, value });
        return value;
    }

    /// Forget the slots that are not in the list
    retain(slots: Iterable<string | number>): void {
        const keep = new Set(slots);
        for (const slot of [...this.entries.keys()]) {
            if (!keep.has(slot)) this.entries.delete(slot);
        }
    }
}
