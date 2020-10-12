import * as proto from '../proto';

/// A value
export class Value {
    /// The type
    sqlType: proto.sql_type.SQLType;
    /// The value
    value: null | number | string | flatbuffers.Long | proto.vector.I128 | proto.vector.Interval;

    /// Constructor
    public constructor() {
        this.sqlType = new proto.sql_type.SQLType();
        this.value = null;
    }

}
