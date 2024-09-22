import * as sqlynx from '@ankoh/sqlynx-core';

export function unpackNameTags(tags: number): sqlynx.proto.NameTag[] {
    const out = [];
    for (const tag of [
        sqlynx.proto.NameTag.SCHEMA_NAME,
        sqlynx.proto.NameTag.DATABASE_NAME,
        sqlynx.proto.NameTag.TABLE_NAME,
        sqlynx.proto.NameTag.TABLE_ALIAS,
        sqlynx.proto.NameTag.COLUMN_NAME,
    ]) {
        if ((tags & tag) != 0) {
            out.push(Number(tag) as sqlynx.proto.NameTag);
        }
    }
    return out;
}

export function getNameTagName(tag: sqlynx.proto.NameTag): string {
    switch (tag) {
        case sqlynx.proto.NameTag.SCHEMA_NAME:
            return 'schema';
        case sqlynx.proto.NameTag.DATABASE_NAME:
            return 'database';
        case sqlynx.proto.NameTag.TABLE_NAME:
            return 'table';
        case sqlynx.proto.NameTag.TABLE_ALIAS:
            return 'query_result alias';
        case sqlynx.proto.NameTag.COLUMN_NAME:
            return 'column';
        default:
            return '';
    }
}
