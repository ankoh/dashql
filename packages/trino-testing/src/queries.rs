//! The queries recorded from Trino: long enough to observe progress, plus a cancelled and a failed one.

use crate::QueryOptions;
use std::time::Duration;

/// A recorded query
pub struct RecordedQuery {
    /// The name, also the file name of the recording
    pub name: &'static str,
    /// The SQL text
    pub sql: &'static str,
    /// Session properties
    pub session: &'static [(&'static str, &'static str)],
    /// Cancel the query after this many milliseconds
    pub cancel_after_ms: Option<u64>,
    /// Record the distributed plan
    pub explain: bool,
    /// Does the query fail?
    pub fails: bool,
}

impl RecordedQuery {
    /// The options to run the query with
    pub fn options(&self, query_info_params: &str) -> QueryOptions {
        QueryOptions {
            session: self.session.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            query_info_interval: Some(Duration::from_millis(500)),
            query_info_params: query_info_params.to_string(),
            cancel_after: self.cancel_after_ms.map(Duration::from_millis),
        }
    }
}

/// Keep the parallelism low, so that the queries run long enough for many polls
const SLOW: &[(&str, &str)] = &[("task_concurrency", "1")];

pub const RECORDED_QUERIES: &[RecordedQuery] = &[
    RecordedQuery {
        name: "select_one",
        sql: "SELECT 1",
        session: &[],
        cancel_after_ms: None,
        explain: true,
        fails: false,
    },
    RecordedQuery {
        name: "aggregate_lineitem_sf1",
        sql: "SELECT l_returnflag, l_linestatus, count(*), sum(l_quantity), avg(l_extendedprice) \
              FROM tpch.sf1.lineitem GROUP BY l_returnflag, l_linestatus ORDER BY l_returnflag, l_linestatus",
        session: SLOW,
        cancel_after_ms: None,
        explain: true,
        fails: false,
    },
    RecordedQuery {
        name: "tpch_q3_sf1",
        sql: "SELECT l.l_orderkey, sum(l.l_extendedprice * (1 - l.l_discount)) AS revenue, \
              o.o_orderdate, o.o_shippriority \
              FROM tpch.sf1.customer c, tpch.sf1.orders o, tpch.sf1.lineitem l \
              WHERE c.c_mktsegment = 'BUILDING' AND c.c_custkey = o.o_custkey AND l.l_orderkey = o.o_orderkey \
              AND o.o_orderdate < DATE '1995-03-15' AND l.l_shipdate > DATE '1995-03-15' \
              GROUP BY l.l_orderkey, o.o_orderdate, o.o_shippriority \
              ORDER BY revenue DESC, o.o_orderdate LIMIT 10",
        session: SLOW,
        cancel_after_ms: None,
        explain: true,
        fails: false,
    },
    RecordedQuery {
        name: "cancelled_sf10",
        sql: "SELECT l_returnflag, count(*), sum(l_extendedprice) FROM tpch.sf10.lineitem GROUP BY l_returnflag",
        session: SLOW,
        cancel_after_ms: Some(4000),
        explain: false,
        fails: false,
    },
    RecordedQuery {
        name: "failed_cast",
        sql: "SELECT CAST(n_name AS integer) FROM tpch.tiny.nation",
        session: &[],
        cancel_after_ms: None,
        explain: false,
        fails: true,
    },
];
