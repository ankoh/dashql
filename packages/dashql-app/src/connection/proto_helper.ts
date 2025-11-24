import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf';

export function dateToTimestamp(date: Date | null): pb.google_protobuf.timestamp.Timestamp | undefined {
    if (!date) return undefined;
    return buf.create(pb.google_protobuf.timestamp.TimestampSchema, {
        seconds: BigInt(Math.floor(date.getTime() / 1000)),
        nanos: (date.getTime() % 1000) * 1_000_000,
    });
}

export function timestampToDate(timestamp: pb.google_protobuf.timestamp.Timestamp | undefined): Date | null {
    if (!timestamp) return null;
    const milliseconds = Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1_000_000);
    return new Date(milliseconds);
}

