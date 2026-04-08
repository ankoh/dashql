#[test]
fn test_linked_version_returns_a_version_string() {
    let version = crate::duckdb::linked_version().expect("duckdb native ffi probe should succeed");
    let version = version.expect("bazel builds should link native duckdb");
    assert!(!version.trim().is_empty());
}

#[test]
fn test_query_execution_returns_rows() {
    let has_rows = crate::duckdb::query_returns_rows("SELECT 42 AS answer")
        .expect("duckdb native query execution should succeed");
    let has_rows = has_rows.expect("bazel builds should link native duckdb");
    assert!(has_rows);
}
