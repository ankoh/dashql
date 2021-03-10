// Copyright (c) 2020 The DashQL Authors

import { WebDBRuntime, copyBlobStreamTo } from './webdb_bindings';

export class NodeWebDBRuntime extends WebDBRuntime {
    dashql_blob_stream_underflow(blobId: number, buf: number, size: number): number {
        let blobStream = this.bindings!.getBlobStreamById(blobId);
        if (blobStream === undefined) return 0;
        return copyBlobStreamTo(blobStream, this.bindings!.instance!.HEAPU8, buf, size);
    }
}
