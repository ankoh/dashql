import * as proto from '@dashql/proto';

/// A table scan range
export interface ScanRange {
    /// An offset of a range
    offset: number;
    /// A limit of a range
    limit: number;
}

/// Does a scan range fully include a given range?
export function scanRangeIncludes(range: ScanRange, offset: number, limit: number) {
    const begin = range.offset;
    const end = range.offset + range.limit;
    return begin <= offset && end >= offset + limit;
}

/// Does a scan range fully intersect a given range?
export function scanRangeIntersects(range: ScanRange, offset: number, limit: number) {
    const begin = range.offset;
    const end = range.offset + range.limit;
    return (offset <= begin && offset + limit >= begin) || (offset < end && offset + limit >= end);
}

/// A partial result of a table scan
export interface PartialScanResult {
    /// The range
    range: ScanRange;
    /// The query result buffer
    result: proto.webdb.QueryResult;
}
