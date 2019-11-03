import * as proto from 'tigon-proto';
import * as ctrl from '../ctrl';

// A query plan
export class QueryPlan {
    buffer: ctrl.CoreBuffer<proto.duckdb.QueryPlan>;

    // Constructor
    constructor(buffer: ctrl.CoreBuffer<proto.duckdb.QueryPlan>) {
        this.buffer = buffer;
    }

    public release() {
        this.buffer.release();
    }
};
