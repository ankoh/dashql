//! Invalid transaction control beyond the cases of the `sql_transaction` parser snapshot, which records the trees of
//! the valid forms.

use super::parse;
use crate::scanner::scan;
use std::sync::Arc;

#[test]
fn transaction_invalid_forms() {
    for sql in [
        "start",
        "start read only",
        "begin transaction work",
        "rollback and no chain",
        "commit read only",
        "abort to checkpoint",
        "begin isolation read committed",
        "begin read",
        "begin not",
        "begin , read only",
        "begin read only,,deferrable",
        "savepoint",
        "release",
        "release savepoint 'checkpoint'",
        "rollback to savepoint 'checkpoint'",
        "prepare transaction batch",
        "commit prepared",
        "rollback prepared batch",
        "end prepared 'batch'",
    ] {
        let parsed = parse(Arc::new(scan(sql, 0, 2)));
        assert!(!parsed.errors.is_empty(), "accepted invalid transaction: {sql}");
    }
}
