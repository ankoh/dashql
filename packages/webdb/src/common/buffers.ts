// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';

/** The temporary vector buffers */
export class TmpBuffers {
    vector: proto.Vector;
    vectorU8: proto.VectorU8;
    vectorI64: proto.VectorI64;
    vectorI128: proto.VectorI128;
    vectorF64: proto.VectorF64;
    vectorInterval: proto.VectorInterval;
    vectorString: proto.VectorString;

    constructor() {
        this.vector = new proto.Vector();
        this.vectorU8 = new proto.VectorU8();
        this.vectorI64 = new proto.VectorI64();
        this.vectorI128 = new proto.VectorI128();
        this.vectorF64 = new proto.VectorF64();
        this.vectorInterval = new proto.VectorInterval();
        this.vectorString = new proto.VectorString();
    }
}
