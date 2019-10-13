import * as proto from '../proto/web_api_generated';
import * as ctrl from '../ctrl';

// A query plan
export class QueryPlan {
    buffer: ctrl.CoreBuffer<proto.QueryPlan>;

    // Constructor
    constructor(buffer: ctrl.CoreBuffer<proto.QueryPlan>) {
        this.buffer = buffer;
    }

    public destroy() {
        this.buffer.destroy();
    }
};
