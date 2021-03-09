// Copyright (c) 2020 The DashQL Authors

export interface QueryRunOptions {
    partitionBoundaries?: number[];
}

export function queryOptionsEqual(l?: QueryRunOptions, r?: QueryRunOptions) {
    if (!l) return !r;
    if (!r) return !l;
    let eq = true;
    if (l.partitionBoundaries) {
        eq =
            eq &&
            !!r.partitionBoundaries &&
            l.partitionBoundaries.length === r.partitionBoundaries.length &&
            l.partitionBoundaries.every((v, i) => v === r.partitionBoundaries![i]);
    }
    return eq;
}
