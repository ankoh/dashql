import * as proto from 'tigon-proto';
import * as ctrl from '../ctrl';

// A query plan
export class QueryPlan {
    buffer: ctrl.CoreBuffer<proto.web_api.QueryPlan>;

    // Constructor
    constructor(buffer: ctrl.CoreBuffer<proto.web_api.QueryPlan>) {
        this.buffer = buffer;
    }

    public destroy() {
        this.buffer.destroy();
    }
};
