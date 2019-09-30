import * as proto from '../proto/web_api_generated';
import * as ctrl from '../ctrl';

// A query plan
export class QueryPlan {
    plan: ctrl.CoreBuffer<proto.QueryPlan>;

    // Constructor
    constructor(plan: ctrl.CoreBuffer<proto.QueryPlan>) {
        this.plan = plan;
    }

    public destroy() {
        this.plan.destroy();
    }
};
