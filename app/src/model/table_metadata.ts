import * as arrow from 'apache-arrow';

export interface TableMetadata {
    table_name: string;
    column_names: string[];
    column_name_mapping: { [idx: string]: number };
    column_types: string[];
    row_count: number;
}

export function readCoreArrowType(type: string) {
    switch (type) {
        case 'Bool':
            return new arrow.Bool();
        case 'Int8':
            return new arrow.Int8();
        case 'Int32':
            return new arrow.Int32();
        case 'Int64':
            return new arrow.Int64();
        case 'Uint8':
            return new arrow.Uint8();
        case 'Uint16':
            return new arrow.Uint16();
        case 'Uint32':
            return new arrow.Uint32();
        case 'Uint64':
            return new arrow.Uint64();
        case 'Float32':
            return new arrow.Float32();
        case 'Float64':
            return new arrow.Float64();
        case 'Date32':
            return new arrow.DateDay();
        case 'Null':
            return new arrow.Null();
        case 'Utf8':
            return new arrow.Utf8();
        default:
            console.error(`unknown core arrow type: ${type}`);
            return new arrow.Null();
    }
}
