//! Tests of completion at the script cursor.

// Bison names some symbol kinds in mixed case (S_Op)
#![allow(non_upper_case_globals)]

use dashql_core::catalog::CatalogLayer;
use dashql_buffers::analyzer::NameTag;
use dashql_buffers::completion::CandidateTag;
use dashql_core::catalog::Catalog;
use dashql_core::completion::{is_symbol_kind_completable, Candidate, CandidateField, CandidateInfo, Completion};
use dashql_core::pack::pack_completion;
use dashql_core::script::Script;
use dashql_parser::symbol_kind::*;

/// The completion limit of the tests
const DEFAULT_LIMIT: usize = 10;

fn find_candidate<'x>(completion: &'x Completion, name: &str) -> Option<&'x Candidate> {
    completion.top_candidates.iter().find(|c| &*c.completion_text == name)
}

fn has_tag(candidate: &Candidate, tag: CandidateTag) -> bool {
    candidate.candidate_tags & tag.0 != 0
}

fn has_name_tag(candidate: &Candidate, tag: NameTag) -> bool {
    candidate.coarse_name_tags & tag.0 != 0
}

/// Create and analyze a script
fn analyze(catalog: &Catalog, text: &str) -> Script {
    let mut script = Script::new(catalog);
    script.insert_text_at(0, text);
    script.analyze(catalog, true).unwrap();
    script
}

/// Create, analyze and load a script into the catalog with rank 0
fn load_schema(catalog: &mut Catalog, text: &str) -> Script {
    let script = analyze(catalog, text);
    catalog.load_script(script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    script
}

/// Analyze a script, move the cursor to a text offset and complete with a limit.
/// Calls `check` with the completion.
fn complete_at(catalog: &Catalog, text: &str, offset: usize, limit: usize, check: impl FnOnce(&Completion)) {
    let mut script = analyze(catalog, text);
    let cursor = script.move_cursor(catalog, offset);
    let completion = Script::complete_at_cursor(&cursor, limit).unwrap();
    check(&completion);
}

/// The offset right after the first occurrence of `needle`
fn after(text: &str, needle: &str) -> usize {
    text.find(needle).unwrap() + needle.len()
}

#[test]
fn operators_are_not_completable() {
    for symbol in [S_EQUALS, S_Op, S_EQUALS_GREATER, S_LESS_EQUALS, S_GREATER_EQUALS, S_NOT_EQUALS] {
        assert!(!is_symbol_kind_completable(symbol));
    }
    assert!(is_symbol_kind_completable(S_IDENT));
}

const TPCH_SCHEMA: &str = r#"
create table part (p_partkey integer not null, p_name varchar(55) not null, p_mfgr char(25) not null, p_brand char(10) not null, p_type varchar(25) not null, p_size integer not null, p_container char(10) not null, p_retailprice decimal(12,2) not null, p_comment varchar(23) not null, primary key (p_partkey));
create table supplier (s_suppkey integer not null, s_name char(25) not null, s_address varchar(40) not null, s_nationkey integer not null, s_phone char(15) not null, s_acctbal decimal(12,2) not null, s_comment varchar(101) not null, primary key (s_suppkey));
create table partsupp (ps_partkey integer not null, ps_suppkey integer not null, ps_availqty integer not null, ps_supplycost decimal(12,2) not null, ps_comment varchar(199) not null, primary key (ps_partkey,ps_suppkey));
create table customer (c_custkey integer not null, c_name varchar(25) not null, c_address varchar(40) not null, c_nationkey integer not null, c_phone char(15) not null, c_acctbal decimal(12,2) not null, c_mktsegment char(10) not null, c_comment varchar(117) not null, primary key (c_custkey));
create table orders (o_orderkey integer not null, o_custkey integer not null, o_orderstatus char(1) not null, o_totalprice decimal(12,2) not null, o_orderdate date not null, o_orderpriority char(15) not null, o_clerk char(15) not null, o_shippriority integer not null, o_comment varchar(79) not null, primary key (o_orderkey));
create table lineitem (l_orderkey integer not null, l_partkey integer not null, l_suppkey integer not null, l_linenumber integer not null, l_quantity decimal(12,2) not null, l_extendedprice decimal(12,2) not null, l_discount decimal(12,2) not null, l_tax decimal(12,2) not null, l_returnflag char(1) not null, l_linestatus char(1) not null, l_shipdate date not null, l_commitdate date not null, l_receiptdate date not null, l_shipinstruct char(25) not null, l_shipmode char(10) not null, l_comment varchar(44) not null, primary key (l_orderkey,l_linenumber));
create table nation (n_nationkey integer not null, n_name char(25) not null, n_regionkey integer not null, n_comment varchar(152) not null, primary key (n_nationkey));
create table region (r_regionkey integer not null, r_name char(25) not null, r_comment varchar(152) not null, primary key (r_regionkey));
"#;

#[test]
fn tpch_q2() {
    let main_script_text = "\nSELECT s_co\n    ";

    let mut catalog = Catalog::new();
    let mut external_script = Script::new(&catalog);
    external_script.insert_text_at(0, TPCH_SCHEMA);
    external_script.scan();
    external_script.parse();
    external_script.analyze(&catalog, true).unwrap();
    catalog.load_script(external_script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();

    let mut main_script = Script::new(&catalog);
    main_script.insert_text_at(0, main_script_text);
    main_script.scan();
    main_script.parse();
    main_script.analyze(&catalog, true).unwrap();

    // Move the cursor
    let cursor_ofs = main_script_text.find("s_co").unwrap();
    assert_eq!(cursor_ofs, 8);
    let cursor = main_script.move_cursor(&catalog, cursor_ofs + "s_co".len());

    // Compute completion
    let completion = Script::complete_at_cursor(&cursor, DEFAULT_LIMIT).unwrap();
    let names: Vec<String> = completion
        .top_candidates
        .iter()
        .map(|candidate| match candidate.keyword_continuation.filter(|k| !k.is_empty()) {
            Some(continuation) => format!("{} {}", candidate.completion_text, continuation),
            None => candidate.completion_text.to_string(),
        })
        .collect();
    let expected_names = ["s_co", "s_comment", "ps_comment", "from", "where", "group by", "order by", "by", "case", "cast"];
    assert_eq!(names, expected_names);
}

#[test]
fn dot_completion_before_later_cte_lines() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(
        &mut catalog,
        "CREATE TABLE uip_iceberg.cdp_usage_nonprod_events.hyperdb_queries(event_id BIGINT, processed_rows BIGINT);",
    );

    let text = "with foo as (\nselect * from uip_iceberg.cdp_usage_nonprod_events.hyperdb_queries q where q.\n\n) ";
    let mut script = analyze(&catalog, text);
    let cursor_offset = text.find("q.\n").unwrap() + 2;
    let cursor = script.move_cursor(&catalog, cursor_offset);
    let location = cursor.scanner_location.expect("scanner location");
    assert!(location.current.is_trailing_dot() || location.previous.is_some_and(|p| p.is_trailing_dot()));
    assert!(!cursor.name_scopes.is_empty());
    // The parser recovered `q.` without a column ref node
    assert!(matches!(cursor.context, dashql_core::cursor::CursorContext::AliasDot));

    let completion = Script::complete_at_cursor(&cursor, 50).unwrap();
    assert!(find_candidate(&completion, "event_id").is_some());
    assert!(find_candidate(&completion, "processed_rows").is_some());
}

#[test]
fn completes_qualified_columns_in_explicit_join() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE test1(a int, a_value int); CREATE TABLE test2(b int, b_value int);");

    for (qualifier, expected_column) in [("a.", "a_value"), ("b.", "b_value")] {
        let text = format!("select * from test1 a left outer join test2 b on {qualifier}");
        let mut script = analyze(&catalog, &text);
        let cursor = script.move_cursor(&catalog, text.len());
        assert!(!cursor.name_scopes.is_empty(), "{qualifier}");
        let analyzed = cursor.script.analyzed.unwrap();
        let scope = &analyzed.name_scopes[cursor.name_scopes[0] as usize];
        assert!(scope.source("a").is_some());
        assert!(scope.source("b").is_some());
        assert!(matches!(cursor.context, dashql_core::cursor::CursorContext::AliasDot), "{qualifier}");

        let completion = Script::complete_at_cursor(&cursor, 50).unwrap();
        assert!(find_candidate(&completion, expected_column).is_some(), "{qualifier}");
    }
}

#[test]
fn insert_target_columns_are_in_scope() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE target(id int, label text);");

    let text = "insert into target(la) values (1)";
    complete_at(&catalog, text, text.find("la)").unwrap() + 2, DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "label").expect("label");
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
    });
}

#[test]
fn insert_returning_columns_are_in_scope() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE target(id int, label text);");

    let text = "insert into target values (1, 'one') returning la";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "label").expect("label");
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
    });
}

#[test]
fn insert_source_does_not_see_write_target_columns() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE target(id int, label text); CREATE TABLE source(source_id int);");

    let text = "insert into target select la from source";
    complete_at(&catalog, text, text.find("la from").unwrap() + 2, DEFAULT_LIMIT, |completion| {
        if let Some(candidate) = find_candidate(completion, "label") {
            assert!(!has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
        }
    });
}

#[test]
fn insert_source_completes_leading_cte() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE target(id int);");

    let text = "with source as (select 1 as id) insert into target select * from sou";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "source").expect("source");
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
    });
}

#[test]
fn insert_source_does_not_dot_complete_write_target() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE target(id int, label text);");

    let text = "insert into target select target.la";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        assert!(find_candidate(completion, "label").is_none());
    });
}

/// Scan, parse and analyze a script, complete at the end of `needle`, and return the candidate with
/// the completion text `name` (`None` if missing) and its keyword continuation
fn continuation_of(catalog: &Catalog, text: &str, needle: &str, name: &str) -> Option<Option<&'static str>> {
    let mut script = Script::new(catalog);
    script.insert_text_at(0, text);
    script.scan();
    script.parse();
    script.analyze(catalog, true).unwrap();
    let cursor = script.move_cursor(catalog, after(text, needle));
    let completion = Script::complete_at_cursor(&cursor, DEFAULT_LIMIT).unwrap();
    find_candidate(&completion, name).map(|c| c.keyword_continuation.filter(|k| !k.is_empty()))
}

#[test]
fn keyword_continuation_group_by() {
    let catalog = Catalog::new();
    let continuation = continuation_of(&catalog, "\nSELECT * FROM supplier gro\n    ", "gro", "group");
    assert_eq!(continuation, Some(Some("by")), "Expected 'group' candidate with continuation");
}

#[test]
fn keyword_continuation_order_by() {
    let catalog = Catalog::new();
    let continuation = continuation_of(&catalog, "\nSELECT * FROM supplier ord\n    ", "ord", "order");
    assert_eq!(continuation, Some(Some("by")), "Expected 'order' candidate with continuation");
}

#[test]
fn keyword_continuation_no_ambiguous() {
    let catalog = Catalog::new();
    // "select" has many possible continuations, should NOT have a keyword_continuation
    if let Some(continuation) = continuation_of(&catalog, "\nSELECT sel\n    ", "sel", "select") {
        assert_eq!(continuation, None, "'select' should not have a continuation (ambiguous)");
    }
}

#[test]
fn keyword_continuation_cte_identifier() {
    let mut catalog = Catalog::new();
    let mut external_script = Script::new(&catalog);
    external_script.insert_text_at(0, "create table foo(a int);");
    external_script.scan();
    external_script.parse();
    external_script.analyze(&catalog, true).unwrap();
    catalog.load_script(external_script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();

    // Identifier candidate "foo" in CTE position should get "as" continuation
    let continuation = continuation_of(&catalog, "\nWITH fo\n    ", "fo", "foo");
    assert_eq!(continuation, Some(Some("as")), "'foo' should have 'as' continuation in CTE position");
}

#[test]
fn completes_prior_cte_in_later_from() {
    let text = "\nWITH events AS (SELECT 1 AS event_id),\nfiltered AS (SELECT * FROM eve)\nSELECT * FROM filtered\n";
    let catalog = Catalog::new();
    complete_at(&catalog, text, text.find("eve)").unwrap() + "eve".len(), DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "events").expect("events");
        assert!(has_name_tag(candidate, NameTag::TABLE_NAME));
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
        assert!(candidate.score > 50);
    });
}

#[test]
fn completes_cte_output_column_in_later_cte() {
    let text = "\nWITH events AS (SELECT 1 AS event_timestamp, 2 AS cpu_time),\nfiltered AS (SELECT event_t FROM events)\nSELECT * FROM filtered\n";
    let catalog = Catalog::new();
    complete_at(&catalog, text, text.find("event_t FROM").unwrap() + "event_t".len(), DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "event_timestamp").expect("event_timestamp");
        assert!(has_name_tag(candidate, NameTag::COLUMN_NAME));
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
        assert!(candidate.score > 59);
    });
}

#[test]
fn completes_cte_output_column_after_dot() {
    let text = "\nWITH events AS (SELECT 1 AS event_timestamp, 2 AS cpu_time)\nSELECT events.event_t FROM events\n";
    let catalog = Catalog::new();
    complete_at(&catalog, text, text.find("event_t FROM").unwrap() + "event_t".len(), DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "event_timestamp").expect("event_timestamp");
        assert!(has_tag(candidate, CandidateTag::DOT_RESOLUTION_COLUMN));
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
    });
}

#[test]
fn local_cte_column_shadows_catalog_objects() {
    let text = "\nWITH events AS (SELECT 1 AS event_timestamp)\nSELECT event_t FROM events\n";
    let mut catalog = Catalog::new();
    let _catalog_script = load_schema(&mut catalog, "CREATE TABLE unrelated(event_timestamp int);");

    complete_at(&catalog, text, text.find("event_t FROM").unwrap() + "event_t".len(), DEFAULT_LIMIT, |completion| {
        let candidate = find_candidate(completion, "event_timestamp").expect("event_timestamp");
        assert!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
        assert!(candidate.catalog_objects.is_empty());
    });
}

#[test]
fn does_not_complete_later_or_self_cte() {
    let text = "\nWITH first AS (SELECT * FROM la),\nlater AS (SELECT 1 AS value)\nSELECT * FROM first\n";
    let catalog = Catalog::new();
    complete_at(&catalog, text, text.find("la)").unwrap() + "la".len(), DEFAULT_LIMIT, |completion| {
        if let Some(candidate) = find_candidate(completion, "later") {
            assert!(!has_tag(candidate, CandidateTag::IN_NAME_SCOPE));
        }
    });
}

#[test]
fn completes_self_cte_only_when_recursive() {
    for (query, expect_in_scope) in [
        ("WITH items AS (SELECT * FROM ite) SELECT * FROM items", false),
        ("WITH RECURSIVE items AS (SELECT * FROM ite) SELECT * FROM items", true),
    ] {
        let catalog = Catalog::new();
        complete_at(&catalog, query, query.find("ite)").unwrap() + "ite".len(), DEFAULT_LIMIT, |completion| {
            let candidate = find_candidate(completion, "items").expect("items");
            assert_eq!(has_tag(candidate, CandidateTag::IN_NAME_SCOPE), expect_in_scope, "{query}");
        });
    }
}

/// Scan, parse and analyze a script and complete at its end
fn complete_at_end(text: &str, check: impl FnOnce(&Completion)) {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, text);
    script.scan();
    script.parse();
    script.analyze(&catalog, true).unwrap();
    let cursor = script.move_cursor(&catalog, text.len());
    let completion = Script::complete_at_cursor(&cursor, DEFAULT_LIMIT).unwrap();
    check(&completion);
}

#[test]
fn passive_hint_select_star() {
    // Should suggest FROM as the top candidate (not WHERE)
    complete_at_end("select * ", |completion| {
        assert!(!completion.top_candidates.is_empty());
        assert_eq!(&*completion.top_candidates[0].completion_text, "from");
    });
}

#[test]
fn function_call_is_atomic() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "create function mysum(x int) returns int;");

    let text = "select mys";
    complete_at(&catalog, text, text.len(), 10, |completion| {
        let packed = pack_completion(completion, false);
        let candidate = packed
            .candidates
            .as_ref()
            .unwrap()
            .iter()
            .find(|c| c.display_text.as_deref() == Some("mysum"))
            .expect("mysum");
        assert_eq!(candidate.completion_text.as_deref(), Some("mysum()"));
        assert_eq!(candidate.completion_cursor_offset as usize, "mysum(".len());
    });
}

#[test]
fn passive_hint_suppress_after_from() {
    // Should produce no passive hint after FROM
    complete_at_end("select * from ", |completion| assert!(completion.top_candidates.is_empty()));
}

#[test]
fn passive_hint_suppress_after_where() {
    // Should produce no passive hint after WHERE
    complete_at_end("select * from foo where ", |completion| assert!(completion.top_candidates.is_empty()));
}

#[test]
fn passive_hint_after_from_table() {
    // After a table name, should suggest WHERE (not suppressed)
    complete_at_end("select * from foo ", |completion| {
        assert!(!completion.top_candidates.is_empty());
        assert_eq!(&*completion.top_candidates[0].completion_text, "where");
    });
}

/// Scan, parse and analyze a script and complete at the end of `needle`
fn complete_after(text: &str, needle: &str, check: impl FnOnce(&Completion)) {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, text);
    script.scan();
    script.parse();
    script.analyze(&catalog, true).unwrap();
    let cursor = script.move_cursor(&catalog, after(text, needle));
    let completion = Script::complete_at_cursor(&cursor, DEFAULT_LIMIT).unwrap();
    check(&completion);
}

#[test]
fn no_completion_inside_line_comment() {
    // Cursor at the end of "sel" inside the line comment.
    complete_after("\nSELECT 1 -- sel\n    ", "sel", |completion| {
        assert!(
            completion.top_candidates.is_empty(),
            "Expected no completion inside a line comment, got {}",
            completion.top_candidates.len()
        );
    });
}

#[test]
fn no_completion_inside_block_comment() {
    // Cursor at the end of "sel" inside the block comment.
    complete_after("\nSELECT 1 /* sel */ FROM x\n    ", "sel", |completion| {
        assert!(
            completion.top_candidates.is_empty(),
            "Expected no completion inside a block comment, got {}",
            completion.top_candidates.len()
        );
    });
}

#[test]
fn completion_right_before_comment() {
    // Cursor at the end of "gro", immediately before the `--` comment start.
    // The comment right after the cursor must not suppress completion: "group" is still offered.
    complete_after("\nSELECT * FROM supplier gro-- comment\n    ", "gro", |completion| {
        assert!(find_candidate(completion, "group").is_some(), "Expected completion right before a comment");
    });
}

#[test]
fn identity_candidate_reproduces_quoted_input_verbatim() {
    // A delimited identifier in a projection whose schema is unknown (e.g. an external() table)
    // has no matching catalog name, so the identity candidate is what the user accepts. It must
    // reproduce the typed text verbatim, so completing it is a no-op instead of a visible
    // delete-and-reinsert. Two failure modes we guard against:
    //   - `"Year"` re-quoted a second time by Pack() -> `"""Year"""`
    //   - `"year"` re-emitted unquoted -> `year` (dropping the quotes the user typed)
    for typed in ["\"Year\"", "\"year\""] {
        let text = format!("SELECT {typed}");
        let catalog = Catalog::new();
        let mut script = Script::new(&catalog);
        script.insert_text_at(0, &text);
        script.scan();
        script.parse();
        script.analyze(&catalog, true).unwrap();

        // Cursor just before the closing quote of the delimited identifier.
        let cursor = script.move_cursor(&catalog, text.len() - 1);
        let completion = Script::complete_at_cursor(&cursor, DEFAULT_LIMIT).unwrap();

        let mut found_identity = false;
        for candidate in &completion.top_candidates {
            if has_tag(candidate, CandidateTag::IDENTITY) {
                found_identity = true;
                // The identity candidate must equal the typed text, quotes and all.
                assert_eq!(&*candidate.completion_text, typed, "Identity candidate must reproduce the typed text verbatim");
            }
        }
        assert!(found_identity, "Expected an identity candidate for {typed}");
    }
}

#[test]
fn completes_inserted_cte_name_before_long_suffix() {
    let main_script_text = r#"with  as (
    select
      *,
      date_trunc('hour', event_timestamp) ts_hour
    from uip_iceberg.cdp_usage_prod_events.hyperdb_queries
    where tenant = 'a360/prod/1e51a99248ee43beb982c09ea3ed8786'
    and event_timestamp >= current_timestamp - interval '30' day
), windowed as (
  select
    *,
    ts_hour,
    row_number() over (partition by tenant order by processed_rows desc) as rnk_processed_rows
  from d
)
select *
from windowed
where rnk_processed_rows < 10
"#;
    let catalog = Catalog::new();
    let mut main_script = analyze(&catalog, main_script_text);

    let cursor_offset = "with ".len();
    main_script.move_cursor(&catalog, cursor_offset);
    main_script.insert_text_at(cursor_offset, "q");
    main_script.analyze(&catalog, true).unwrap();
    let cursor = main_script.move_cursor(&catalog, cursor_offset + 1);
    assert!(Script::complete_at_cursor(&cursor, DEFAULT_LIMIT).is_ok());
}

#[test]
fn completes_columns_of_derived_tables_after_a_recovered_dot() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "CREATE TABLE t(a int, b int);");

    for text in [
        "with c as (select a as k, b from t) select * from t join c x on x.",
        "select * from t join (select a as k, b from t) x on x.",
    ] {
        let mut script = analyze(&catalog, text);
        let cursor = script.move_cursor(&catalog, text.len());
        // The parser recovered `x.` without a column ref node
        assert!(matches!(cursor.context, dashql_core::cursor::CursorContext::AliasDot), "{text}");

        let completion = Script::complete_at_cursor(&cursor, 50).unwrap();
        let k = find_candidate(&completion, "k").unwrap_or_else(|| panic!("k: {text}"));
        assert!(has_tag(k, CandidateTag::DOT_RESOLUTION_COLUMN), "{text}");
        assert!(find_candidate(&completion, "b").is_some(), "{text}");
    }
}

/// Client functions that cover what a list shows about a candidate
const INFO_SPEC: &str = r#"{
  "format": 1,
  "namespace": "svc",
  "title": "The Service",
  "schemas": {
    "Owner": {
      "attributes": [
        { "name": "note", "type": "string" },
        { "name": "id", "type": "integer", "required": true, "description": "The id." }
      ]
    },
    "Email": { "attributes": [{ "name": "address", "type": "string" }] },
    "Queue": { "attributes": [{ "name": "name", "type": "string" }] },
    "Target": { "variants": ["Email", "Queue"] }
  },
  "functions": [
    {
      "name": "item_get",
      "family": "Items",
      "method": "GET",
      "path": "/items/{id}",
      "description": "Reads an item.",
      "example": "CALL svc.item_get (id => 'a');",
      "result_description": "One row.",
      "options": [
        { "name": "owner", "schema": "Owner" },
        { "name": "id", "in": "path", "type": "string", "required": true, "description": "The `id` of the item." },
        { "name": "labels", "type": "string", "map": true }
      ],
      "columns": [{ "name": "id", "type": "VARCHAR" }, { "name": "size", "type": "BIGINT" }]
    },
    {
      "name": "item_find",
      "method": "GET",
      "options": [
        { "name": "ids", "type": "integer", "array": 2 },
        { "name": "kind", "type": "string", "enum": ["a", "b"], "format": "kind-name" },
        { "name": "target", "schema": "Target", "array": 1 }
      ]
    },
    { "name": "item_list", "method": "GET", "paging": { "kind": "url", "from": { "link": "next" } } },
    { "name": "item_ping", "method": "GET", "options": [{ "name": "id", "type": "string", "required": true }] },
    { "name": "item_raw", "raw": true }
  ]
}"#;

fn info_catalog() -> Catalog {
    let mut catalog = Catalog::new();
    catalog.register_client_functions(INFO_SPEC).unwrap();
    catalog
}

/// The name of a candidate, its name tags and what a list shows about it
fn client_candidates(catalog: &Catalog, text: &str) -> Vec<(String, u8, Option<String>, Option<String>)> {
    let mut out = Vec::new();
    complete_at(catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        for candidate in &completion.top_candidates {
            assert!(candidate.catalog_objects.is_empty());
            out.push((
                candidate.completion_text.to_string(),
                candidate.coarse_name_tags,
                candidate.info.detail.clone(),
                candidate.info.description.clone(),
            ));
        }
    });
    out
}

fn text(value: &str) -> Option<String> {
    Some(value.to_string())
}

#[test]
fn client_namespaces_are_described() {
    let candidates = client_candidates(&info_catalog(), "call sv");
    assert_eq!(candidates, vec![("svc".to_string(), NameTag::SCHEMA_NAME.0, text("The Service"), None)]);
}

#[test]
fn client_functions_are_described() {
    let tag = NameTag::FUNCTION_NAME.0;
    assert_eq!(
        client_candidates(&info_catalog(), "call svc."),
        vec![
            ("item_find".to_string(), tag, text("(ids? array of array of integer, kind? string, target? array)"), None),
            ("item_get".to_string(), tag, text("(id string, owner?, labels? map of string)"), text("Reads an item.")),
            ("item_list".to_string(), tag, None, None),
            ("item_ping".to_string(), tag, text("(id string)"), None),
            ("item_raw".to_string(), tag, None, None),
        ]
    );
}

#[test]
fn client_options_are_described() {
    let tag = NameTag::OPTION_NAME.0;
    assert_eq!(
        client_candidates(&info_catalog(), "call svc.item_get ("),
        vec![
            ("id".to_string(), tag, text("string · required"), text("The `id` of the item.")),
            ("labels".to_string(), tag, text("map of string"), None),
            ("owner".to_string(), tag, None, None),
        ]
    );
    assert_eq!(
        client_candidates(&info_catalog(), "call svc.item_get (owner => ("),
        vec![
            ("id".to_string(), tag, text("integer · required"), text("The id.")),
            ("note".to_string(), tag, text("string"), None),
        ]
    );
}

#[test]
fn standard_options_are_described() {
    let candidates = client_candidates(&info_catalog(), "call svc.item_list (");
    let names: Vec<&str> = candidates.iter().map(|c| c.0.as_str()).collect();
    assert_eq!(names, vec!["_next", "_pages"]);
    assert_eq!(candidates[0].1, NameTag::OPTION_NAME.0);
    assert_eq!(candidates[0].2, text("string"));
    assert!(candidates[0].3.as_ref().unwrap().contains("`_next`"));
    assert_eq!(candidates[1].2, text("integer"));
}

/// The info of a candidate of a call
fn client_info(text: &str, name: &str) -> CandidateInfo {
    let mut info = None;
    complete_at(&info_catalog(), text, text.len(), DEFAULT_LIMIT, |completion| {
        let candidate = completion.top_candidates.iter().find(|c| &*c.completion_text == name).unwrap();
        info = Some(candidate.info.clone());
    });
    info.unwrap()
}

/// The names and details of a table of an info
fn field_details(fields: &[CandidateField]) -> Vec<(&str, Option<&str>)> {
    fields.iter().map(|f| (f.name.as_str(), f.detail.as_deref())).collect()
}

#[test]
fn a_function_shows_its_parameters_and_result() {
    let info = client_info("call svc.", "item_get");
    assert_eq!(
        field_details(&info.parameters),
        vec![("id", Some("string · required")), ("owner", None), ("labels", Some("map of string"))]
    );
    assert_eq!(info.parameters[0].description.as_deref(), Some("The `id` of the item."));
    assert_eq!(field_details(&info.columns), vec![("id", Some("VARCHAR")), ("size", Some("BIGINT"))]);
    assert_eq!(info.result_description.as_deref(), Some("One row."));
    assert_eq!(info.example.as_deref(), Some("CALL svc.item_get (id => 'a');"));
    assert_eq!(field_details(&info.facts), vec![("Family", Some("Items")), ("Endpoint", Some("GET /items/{id}"))]);
}

#[test]
fn a_function_lists_its_standard_options_after_its_own() {
    let info = client_info("call svc.", "item_list");
    assert_eq!(field_details(&info.parameters), vec![("_next", Some("string")), ("_pages", Some("integer"))]);
    assert!(info.parameters[0].description.as_ref().unwrap().contains("`_next`"));
    assert_eq!(field_details(&info.facts), vec![("Paging", Some("url"))]);
}

#[test]
fn an_option_shows_the_attributes_of_its_schema() {
    let info = client_info("call svc.item_get (", "owner");
    assert_eq!(field_details(&info.parameters), vec![("id", Some("integer · required")), ("note", Some("string"))]);
}

#[test]
fn an_option_shows_its_nesting_values_and_what_its_variants_take() {
    assert_eq!(client_info("call svc.item_find (", "ids").detail.as_deref(), Some("array of array of integer"));
    let kind = client_info("call svc.item_find (", "kind");
    assert_eq!(field_details(&kind.facts), vec![("Values", Some("a, b")), ("Format", Some("kind-name"))]);
    let target = client_info("call svc.item_find (", "target");
    assert_eq!(target.detail.as_deref(), Some("array"));
    assert!(target.facts.is_empty());
    assert_eq!(field_details(&target.parameters), vec![("address", Some("string")), ("name", Some("string"))]);
}

#[test]
fn a_table_shows_its_columns_as_written_with_their_types() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(
        &mut catalog,
        r#"create table mytable (zip varchar(10), amount numeric(10,2), kind "USER-DEFINED", tags text[], plain "timestamp with time zone");"#,
    );
    let text = "select * from mytab";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        let candidate = completion.top_candidates.iter().find(|c| &*c.completion_text == "mytable").unwrap();
        let info = &completion.candidate_objects[candidate.catalog_objects[0]].info;
        assert_eq!(info.detail.as_deref(), Some("5 columns"));
        assert_eq!(
            field_details(&info.columns),
            vec![
                ("zip", Some("varchar(10)")),
                ("amount", Some("numeric(10,2)")),
                ("kind", Some("user-defined")),
                ("tags", Some("text[]")),
                ("plain", Some("timestamp with time zone")),
            ]
        );
    });
}

#[test]
fn a_wide_table_shows_only_its_first_columns() {
    let mut catalog = Catalog::new();
    let columns: Vec<String> = (0..250).map(|i| format!("c{i} int")).collect();
    let _schema = load_schema(&mut catalog, &format!("create table mytable ({});", columns.join(", ")));
    let text = "select * from mytab";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        let candidate = completion.top_candidates.iter().find(|c| &*c.completion_text == "mytable").unwrap();
        let info = &completion.candidate_objects[candidate.catalog_objects[0]].info;
        assert_eq!(info.detail.as_deref(), Some("250 columns"));
        assert_eq!(info.columns.len(), 200);
        assert_eq!(info.columns[0].name, "c0");
        assert_eq!(info.columns[199].name, "c199");
    });
}

#[test]
fn a_column_shows_its_type_and_table() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "create table mytable (mycolumn bigint);");
    let text = "select mycol from mytable";
    complete_at(&catalog, text, "select mycol".len(), DEFAULT_LIMIT, |completion| {
        let candidate = completion.top_candidates.iter().find(|c| &*c.completion_text == "mycolumn").unwrap();
        let info = &completion.candidate_objects[candidate.catalog_objects[0]].info;
        assert_eq!(info.detail.as_deref(), Some("bigint · mytable"));
    });
}

#[test]
fn only_the_top_client_candidates_get_their_info() {
    let text = "call svc.item_g";
    complete_at(&info_catalog(), text, text.len(), 1, |completion| {
        assert_eq!(completion.top_candidates.len(), 1);
        assert_eq!(completion.top_candidates[0].info.description.as_deref(), Some("Reads an item."));
    });
}

#[test]
fn only_the_objects_of_top_candidates_get_their_info() {
    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "create table mya (x int); create table myb (x int, y int);");
    let text = "select * from my";
    complete_at(&catalog, text, text.len(), 1, |completion| {
        assert_eq!(completion.top_candidates.len(), 1);
        let top: Vec<usize> = completion.top_candidates[0].catalog_objects.clone();
        assert!(!top.is_empty());
        for (index, object) in completion.candidate_objects.iter().enumerate() {
            assert_eq!(object.info.detail.is_some(), top.contains(&index), "{index}");
        }
    });
}

#[test]
fn candidate_info_is_packed() {
    let catalog = info_catalog();
    let text = "call svc.";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        let packed = pack_completion(completion, false);
        let candidates = packed.candidates.unwrap();
        let candidate = candidates.iter().find(|c| c.display_text.as_deref() == Some("item_get")).unwrap();
        let info = candidate.info.as_ref().unwrap();
        assert_eq!(info.detail.as_deref(), Some("(id string, owner?, labels? map of string)"));
        assert_eq!(info.description.as_deref(), Some("Reads an item."));
        let parameters = info.parameters.as_ref().unwrap();
        assert_eq!(parameters[0].name.as_deref(), Some("id"));
        assert_eq!(parameters[0].detail.as_deref(), Some("string · required"));
        assert_eq!(parameters[0].description.as_deref(), Some("The `id` of the item."));
        assert_eq!(info.columns.as_ref().unwrap()[1].name.as_deref(), Some("size"));
        assert_eq!(info.result_description.as_deref(), Some("One row."));
        assert_eq!(info.example.as_deref(), Some("CALL svc.item_get (id => 'a');"));
        assert_eq!(info.facts.as_ref().unwrap()[0].name.as_deref(), Some("Family"));
    });

    let mut catalog = Catalog::new();
    let _schema = load_schema(&mut catalog, "create function myfn(x int) returns text; create table mytable (a int);");
    let text = "select my";
    complete_at(&catalog, text, text.len(), DEFAULT_LIMIT, |completion| {
        let packed = pack_completion(completion, false);
        let candidates = packed.candidates.unwrap();
        let detail = |name: &str| {
            let candidate = candidates.iter().find(|c| c.display_text.as_deref() == Some(name)).unwrap();
            assert!(candidate.info.is_none());
            let objects = candidate.catalog_objects.as_ref().unwrap();
            objects[0].info.as_ref().and_then(|i| i.detail.clone())
        };
        assert_eq!(detail("myfn").as_deref(), Some("(x int) → text"));
        assert_eq!(detail("mytable").as_deref(), Some("1 column"));
    });
}
