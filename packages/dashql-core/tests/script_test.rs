//! Tests of `Script`: text edits and versions, parsing, analysis, statement text, dashboard and Vega-Lite rewrites,
//! formatting and statistics.

use dashql_core::catalog::CatalogLayer;
use dashql_buffers::status::StatusCode;
use dashql_core::catalog::Catalog;
use dashql_core::script::Script;
use dashql_core::vis_rewrite::{VisCard, VisRenderer};
use dashql_parser::span::TextSpan;

#[test]
fn text_version_changes_only_for_successful_text_edits() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(100, "");
    script.erase_text_range(0, 100);
    script.replace_text("");
    assert_eq!(script.text_version(), 0);

    script.insert_text_at(100, "a\u{e9}z");
    assert_eq!(script.text_version(), 1);
    script.insert_text_at(1, "");
    script.erase_text_range(1, 0);
    script.erase_text_range(3, 100);
    script.erase_text_range(100, 100);
    script.replace_text("a\u{e9}z");
    assert_eq!(script.text_version(), 1);
    assert_eq!(script.to_text(), "a\u{e9}z");

    script.insert_text_at(100, "!");
    assert_eq!(script.text_version(), 2);
    assert_eq!(script.to_text(), "a\u{e9}z!");
    script.erase_text_range(1, 100);
    assert_eq!(script.text_version(), 3);
    assert_eq!(script.to_text(), "a");
    script.replace_text("select 1");
    assert_eq!(script.text_version(), 4);
}

#[test]
fn parse_auto_scans() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, "select 1");
    script.parse();
    assert!(script.parsed.is_some());
}

#[test]
fn analyze_special_function_arguments() {
    let scripts = ["select coalesce(a, b)", "select nullif(a, b)", "select current_time(2)", "select substring(a, 1, 2)"];
    let catalog = Catalog::new();
    for input in scripts {
        let mut script = Script::new(&catalog);
        script.insert_text_at(0, input);
        assert!(script.analyze(&catalog, true).is_ok(), "{input}");
    }
}

#[test]
fn analyze_malformed_query_with_function_arguments() {
    let input = r#"
with events as (
    select *,
      ,
), aggregates_other as (
    select ts_hour, count(*) as metric, 'other' as target
    from events
    where not marker
    group by ts_hour, marker
), aggregates_filtered as (
    select ts_hour, count(*) as metric, 'filtered' as target
    from events
    where marker
    group by ts_hour
)
select * from aggregates_other
union all select * from aggregates_filtered
visualize using vegalite (
    mark => line,
    encoding => (
        x => (field => ts_hour, type => temporal),
        y => (field => metric, type => quantitative, aggregate => 'sum'),
        color => (field => target)
    )
);
"#;
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, input);

    script.analyze(&catalog, true).unwrap();
    let parsed = script.parsed.as_ref().expect("parsed script");
    assert!(!parsed.errors.is_empty());
}

#[test]
fn analyzing_before_parsing() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    let error = script.analyze(&catalog, false).unwrap_err();
    assert_eq!(error.status, Some(StatusCode::SCRIPT_NOT_PARSED));
}

#[test]
fn tpch_q2() {
    let external_script_text = r#"
create table part (p_partkey integer not null, p_name varchar(55) not null, p_mfgr char(25) not null, p_brand char(10) not null, p_type varchar(25) not null, p_size integer not null, p_container char(10) not null, p_retailprice decimal(12,2) not null, p_comment varchar(23) not null, primary key (p_partkey));
create table supplier (s_suppkey integer not null, s_name char(25) not null, s_address varchar(40) not null, s_nationkey integer not null, s_phone char(15) not null, s_acctbal decimal(12,2) not null, s_comment varchar(101) not null, primary key (s_suppkey));
create table partsupp (ps_partkey integer not null, ps_suppkey integer not null, ps_availqty integer not null, ps_supplycost decimal(12,2) not null, ps_comment varchar(199) not null, primary key (ps_partkey,ps_suppkey));
create table customer (c_custkey integer not null, c_name varchar(25) not null, c_address varchar(40) not null, c_nationkey integer not null, c_phone char(15) not null, c_acctbal decimal(12,2) not null, c_mktsegment char(10) not null, c_comment varchar(117) not null, primary key (c_custkey));
create table orders (o_orderkey integer not null, o_custkey integer not null, o_orderstatus char(1) not null, o_totalprice decimal(12,2) not null, o_orderdate date not null, o_orderpriority char(15) not null, o_clerk char(15) not null, o_shippriority integer not null, o_comment varchar(79) not null, primary key (o_orderkey));
create table lineitem (l_orderkey integer not null, l_partkey integer not null, l_suppkey integer not null, l_linenumber integer not null, l_quantity decimal(12,2) not null, l_extendedprice decimal(12,2) not null, l_discount decimal(12,2) not null, l_tax decimal(12,2) not null, l_returnflag char(1) not null, l_linestatus char(1) not null, l_shipdate date not null, l_commitdate date not null, l_receiptdate date not null, l_shipinstruct char(25) not null, l_shipmode char(10) not null, l_comment varchar(44) not null, primary key (l_orderkey,l_linenumber));
create table nation (n_nationkey integer not null, n_name char(25) not null, n_regionkey integer not null, n_comment varchar(152) not null, primary key (n_nationkey));
create table region (r_regionkey integer not null, r_name char(25) not null, r_comment varchar(152) not null, primary key (r_regionkey));
    "#;

    let main_script_text = r#"
select
    s_acctbal,
    s_name,
    n_name,
    p_partkey,
    p_mfgr,
    s_address,
    s_phone,
    s_comment
from
    part,
    supplier,
    partsupp,
    nation,
    region
where
    p_partkey = ps_partkey
    and s_suppkey = ps_suppkey
    and p_size = 15
    and p_type like '%BRASS'
    and s_nationkey = n_nationkey
    and n_regionkey = r_regionkey
    and r_name = 'EUROPE'
    and ps_supplycost = (
        select
            min(ps_supplycost)
        from
            partsupp,
            supplier,
            nation,
            region
        where
            p_partkey = ps_partkey
            and s_suppkey = ps_suppkey
            and s_nationkey = n_nationkey
            and n_regionkey = r_regionkey
            and r_name = 'EUROPE'
    )
order by
    s_acctbal desc,
    n_name,
    s_name,
    p_partkey
limit 100
    "#;

    let mut catalog = Catalog::new();
    let mut external_script = Script::new(&catalog);
    external_script.insert_text_at(0, external_script_text);
    external_script.scan();
    external_script.parse();
    external_script.analyze(&catalog, true).unwrap();

    let mut main_script = Script::new(&catalog);
    main_script.insert_text_at(0, main_script_text);
    main_script.scan();
    main_script.parse();

    catalog.load_script(external_script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    main_script.analyze(&catalog, true).unwrap();
}

#[test]
fn replace_text() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, "foo");
    assert_eq!(script.to_text(), "foo");
    script.replace_text("bar");
    assert_eq!(script.to_text(), "bar");
}

#[test]
fn converts_text_span_to_string() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);

    script.replace_text("select 'Grüße'");
    assert_eq!(script.to_text_span(TextSpan { offset: 7, length: 9 }), "'Grüße'");
    assert_eq!(script.to_text_span(TextSpan { offset: 100, length: 1 }), "");
}

fn parsed_script(text: &str) -> Script {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text(text);
    script.parse();
    script
}

#[test]
fn statement_text_is_the_first_statement_without_separator() {
    assert_eq!(parsed_script("  select 1 ; select 2").statement_text(false).unwrap(), "select 1");
    assert_eq!(parsed_script("").statement_text(false).unwrap(), "");
    assert_eq!(parsed_script("-- only a comment").statement_text(false).unwrap(), "");

    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select 1");
    assert_eq!(script.statement_text(false).unwrap_err().status, Some(StatusCode::SCRIPT_NOT_PARSED));
    assert_eq!(script.statement_text(true).unwrap(), "select 1");
}

fn card(row: Option<i32>, column: Option<i32>, width: i32, height: i32) -> VisCard {
    VisCard { row, column, width, height }
}

fn vegalite(json: &str) -> VisRenderer {
    VisRenderer::from_parts("vegalite", json).unwrap()
}

#[test]
fn rewrite_vis_card_replaces_or_inserts_the_card() {
    // A new card goes after the renderer, in the same comment
    let mut script = parsed_script("/* @vis table */\nselect 1");
    assert_eq!(
        script.rewrite_vis_card(0, Some(&card(Some(2), Some(3), 4, 5)), false).unwrap(),
        "/* @vis table\n   @vis card row=2 column=3 width=4 height=5 */\nselect 1"
    );
    // The card is replaced, the other tags stay as written
    let mut script = parsed_script("/* @vis vegalite {\"mark\":   \"bar\"}\n   @vis card row=9 width=1 */\nselect 1");
    assert_eq!(
        script.rewrite_vis_card(0, Some(&card(None, None, 6, 3)), false).unwrap(),
        "/* @vis vegalite {\"mark\":   \"bar\"}\n   @vis card width=6 height=3 */\nselect 1"
    );
    // Line comments and gutters are continued
    let mut script = parsed_script("-- @vis table\n-- @end\nselect 1");
    assert_eq!(
        script.rewrite_vis_card(0, Some(&card(Some(0), None, 12, 1)), false).unwrap(),
        "-- @vis table\n-- @vis card row=0 width=12 height=1\n-- @end\nselect 1"
    );
    let mut script = parsed_script("/**\n * @description Sales.\n * @vis table\n */\nselect 1");
    assert_eq!(
        script.rewrite_vis_card(0, Some(&card(None, None, 6, 3)), false).unwrap(),
        "/**\n * @description Sales.\n * @vis table\n * @vis card width=6 height=3\n */\nselect 1"
    );
}

#[test]
fn rewrite_vis_card_targets_a_statement() {
    let text = "/* @vis table */\nselect 1;\ndelete from t;\n/* @vis table */\nselect 2";
    let mut script = parsed_script(text);
    assert_eq!(
        script.rewrite_vis_card(0, Some(&card(None, None, 6, 3)), false).unwrap(),
        "/* @vis table\n   @vis card width=6 height=3 */\nselect 1;\ndelete from t;\n/* @vis table */\nselect 2"
    );
    assert_eq!(
        script.rewrite_vis_card(2, Some(&card(None, None, 6, 3)), false).unwrap(),
        "/* @vis table */\nselect 1;\ndelete from t;\n/* @vis table\n   @vis card width=6 height=3 */\nselect 2"
    );
}

#[test]
fn rewrite_vis_card_clamps_the_grid() {
    let mut script = parsed_script("/* @vis table */ select 1");
    // Negative rows are dropped, the width is limited to the 12 columns, the column to the free space
    for (input, expected) in [
        (card(Some(-1), Some(20), 40, -3), "column=0 width=12 height=1"),
        (card(None, Some(20), 4, 1), "column=8 width=4 height=1"),
        (card(None, Some(-5), 0, 2), "column=0 width=1 height=2"),
    ] {
        assert_eq!(
            script.rewrite_vis_card(0, Some(&input), false).unwrap(),
            format!("/* @vis table\n   @vis card {expected} */ select 1")
        );
    }
}

#[test]
fn rewrite_vis_renderer_replaces_inserts_and_removes() {
    // The renderer keeps its place, the comment closes on a line of its own
    let mut script = parsed_script("/* @vis table\n   @vis card width=4 */\nselect 1 as a");
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&vegalite("{\"mark\": \"bar\"}")), false).unwrap(),
        "/* @vis vegalite\n   {\"mark\": \"bar\"}\n   @vis card width=4 */\nselect 1 as a"
    );
    let mut script = parsed_script("/* @vis table */\nselect 1 as a");
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&vegalite("{\"mark\": \"bar\"}")), false).unwrap(),
        "/* @vis vegalite\n   {\"mark\": \"bar\"}\n*/\nselect 1 as a"
    );
    // Markdown templates keep their lines
    let mut script = parsed_script("-- @vis table\n-- @end\nselect 1 as a");
    let markdown = VisRenderer::from_parts("markdown", "### {{a}}\n\n- item").unwrap();
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&markdown), false).unwrap(),
        "-- @vis markdown\n-- ### {{a}}\n--\n-- - item\n-- @end\nselect 1 as a"
    );
    // A query without tags gets a comment, a renderer goes before a card
    let mut script = parsed_script("-- Sales\nselect 1 as a");
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&VisRenderer::Table), false).unwrap(),
        "-- Sales\n/* @vis table */\nselect 1 as a"
    );
    let mut script = parsed_script("/* @vis card width=4 */\nselect 1 as a");
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&VisRenderer::Table), false).unwrap(),
        "/* @vis table\n   @vis card width=4 */\nselect 1 as a"
    );
    // Removing the only tag removes the comment
    let mut script = parsed_script("/* @vis table */\nselect 1 as a");
    assert_eq!(script.rewrite_vis_renderer(0, None, false).unwrap(), "select 1 as a");
}

#[test]
fn rewrite_vis_tags_removes_tags() {
    // The first tag of a comment, the next tag moves up
    let mut script = parsed_script("/* @vis table\n   @vis card width=4 */\nselect 1");
    assert_eq!(script.rewrite_vis_renderer(0, None, false).unwrap(), "/* @vis card width=4 */\nselect 1");
    // The last tag, the comment closes after the previous line
    let mut script = parsed_script("/* @vis table\n   @vis card width=4 */\nselect 1");
    assert_eq!(script.rewrite_vis_card(0, None, false).unwrap(), "/* @vis table */\nselect 1");
    // A tag on a line of its own
    let mut script = parsed_script("/* Sales\n   @vis table\n   @vis card width=4\n*/\nselect 1");
    assert_eq!(script.rewrite_vis_renderer(0, None, false).unwrap(), "/* Sales\n   @vis card width=4\n*/\nselect 1");
    // Line comments keep the end line for the region before
    let mut script = parsed_script("-- @description Sales\n-- @vis table\n-- @end\nselect 1");
    assert_eq!(script.rewrite_vis_renderer(0, None, false).unwrap(), "-- @description Sales\n-- @end\nselect 1");
    let mut script = parsed_script("-- @vis table\n-- @end\nselect 1");
    assert_eq!(script.rewrite_vis_renderer(0, None, false).unwrap(), "select 1");
    // Nothing to remove
    let mut script = parsed_script("select 1");
    assert_eq!(script.rewrite_vis_card(0, None, false).unwrap(), "select 1");
}

#[test]
fn rewrite_vis_tags_escape_comment_delimiters() {
    let mut script = parsed_script("/* @vis table */\nselect 1 as a");
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&vegalite("{\"title\": \"/* a */\"}")), false).unwrap(),
        "/* @vis vegalite\n   {\"title\": \"/\\u002a a *\\/\"}\n*/\nselect 1 as a"
    );
    // The escaped spec reads back unchanged
    let catalog = Catalog::new();
    let mut escaped = Script::new(&catalog);
    escaped.replace_text(&script.rewrite_vis_renderer(0, Some(&vegalite("{\"title\": \"/* a */\"}")), false).unwrap());
    escaped.analyze(&catalog, true).unwrap();
    let analyzed = escaped.analyzed.as_ref().unwrap();
    assert!(analyzed.parsed.scanned.errors.is_empty() && analyzed.errors.is_empty());
    assert_eq!(analyzed.visualization_specs[0].vegalite.as_ref().unwrap()["title"], "/* a */");
    // A Markdown template cannot be escaped in a block comment, line comments take it
    let markdown = VisRenderer::from_parts("markdown", "a */ b").unwrap();
    assert!(script.rewrite_vis_renderer(0, Some(&markdown), false).is_err());
    let mut script = parsed_script("-- @vis table\n-- @end\nselect 1 as a");
    assert_eq!(
        script.rewrite_vis_renderer(0, Some(&markdown), false).unwrap(),
        "-- @vis markdown\n-- a */ b\n-- @end\nselect 1 as a"
    );
}

#[test]
fn vis_tag_warnings_point_at_the_json() {
    // The warnings point at the top-level `data` key and at the `field` value, not at the same text elsewhere
    let text = "-- @vis vegalite {\"description\": \"data\", \"title\": \"b\",\n--   \"data\": {\"name\": \"t\"},\n--   \"encoding\": {\"x\": {\"field\": \"b\"}}}\n-- @end\nselect 1 as a";
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text(text);
    script.analyze(&catalog, true).unwrap();
    let warnings: Vec<usize> = script.analyzed.as_ref().unwrap().errors.iter().map(|e| e.text_span.unwrap().offset as usize).collect();
    assert_eq!(warnings, vec![text.find("\"data\": {").unwrap(), text.rfind("\"b\"").unwrap()]);
}

#[test]
fn rewrite_vis_tags_check_the_statement() {
    let not_parsed = Some(StatusCode::SCRIPT_NOT_PARSED);
    let table = Some(&VisRenderer::Table);
    assert_eq!(parsed_script("/* @vis table */ select 1 +").rewrite_vis_renderer(0, table, false).unwrap_err().status, not_parsed);
    assert!(parsed_script("create table t (a int)").rewrite_vis_renderer(0, table, false).is_err());
    assert!(parsed_script("select 1").rewrite_vis_renderer(1, table, false).is_err());
    // A card needs a renderer
    assert!(parsed_script("select 1").rewrite_vis_card(0, Some(&card(None, None, 6, 3)), false).is_err());
    assert!(VisRenderer::from_parts("vegalite", "[1]").is_err());
    assert!(VisRenderer::from_parts("markdown", " ").is_err());
    assert!(VisRenderer::from_parts("chart", "").is_err());
    // An unparsed script is parsed if requested
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("/* @vis table */ select 1");
    assert_eq!(script.rewrite_vis_renderer(0, None, false).unwrap_err().status, not_parsed);
    assert_eq!(script.rewrite_vis_renderer(0, None, true).unwrap(), "select 1");
}

#[test]
fn rewrite_vis_tags_apply_spans_to_the_current_text() {
    // The spans of the outdated parse are spliced into the new text
    let mut script = parsed_script("/* @vis table */ select 1");
    script.replace_text("/* @vis table */ select 2");
    assert_eq!(
        script.rewrite_vis_card(0, Some(&card(None, None, 6, 3)), false).unwrap(),
        "/* @vis table\n   @vis card width=6 height=3 */ select 2"
    );
    script.replace_text("x");
    assert!(script.rewrite_vis_card(0, Some(&card(None, None, 6, 3)), false).is_err());
}

#[test]
fn rewrite_vegalite_inserts_a_comment() {
    let mut script = parsed_script("/* @description Revenue. */\nselect 1 as a");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark":"bar","encoding":{"x":{"field":"a"}}}"#, false).unwrap().0,
        "/* @description Revenue. */\n/* @vis vegalite\n   {\"mark\": \"bar\", \"encoding\": {\"x\": {\"field\": \"a\"}}}\n*/\nselect 1 as a"
    );
}

#[test]
fn rewrite_vegalite_replaces_the_renderer() {
    // The JSON is aligned with the tag, the card stays
    let mut script = parsed_script("/* @vis vegalite {\"mark\": \"line\"}\n   @vis card width=6 */\nselect 1");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark": "bar"}"#, false).unwrap().0,
        "/* @vis vegalite\n   {\"mark\": \"bar\"}\n   @vis card width=6 */\nselect 1"
    );
    // A multi-line spec and other renderers are replaced
    let mut script = parsed_script("/* @vis card width=6\n   @vis vegalite\n   {\n     \"mark\": \"line\"\n   }\n*/\nselect 1");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark": "bar"}"#, false).unwrap().0,
        "/* @vis card width=6\n   @vis vegalite\n   {\"mark\": \"bar\"}\n*/\nselect 1"
    );
    let mut script = parsed_script("/* @vis table */ select 1");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark": "bar"}"#, false).unwrap().0,
        "/* @vis vegalite\n   {\"mark\": \"bar\"} */ select 1"
    );
    // Line comments and gutters prefix the lines of the spec
    let mut script = parsed_script("-- @vis markdown\n-- **{{a}}**\n-- @vis card width=2\n-- @end\nselect 1");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark": "bar"}"#, false).unwrap().0,
        "-- @vis vegalite\n-- {\"mark\": \"bar\"}\n-- @vis card width=2\n-- @end\nselect 1"
    );
    let mut script = parsed_script("/*\n * @vis table\n * @vis card width=2\n */\nselect 1");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark": "bar"}"#, false).unwrap().0,
        "/*\n * @vis vegalite\n * {\"mark\": \"bar\"}\n * @vis card width=2\n */\nselect 1"
    );
    let mut script = parsed_script("/** @vis table\n  * @vis card width=2 */\nselect 1");
    assert_eq!(
        script.rewrite_vegalite(r#"{"mark": "bar"}"#, false).unwrap().0,
        "/** @vis vegalite\n  * {\"mark\": \"bar\"}\n  * @vis card width=2 */\nselect 1"
    );
}

#[test]
fn rewrite_vegalite_returns_the_span_of_the_tag() {
    let (text, span) = parsed_script("/* @vis table\n   @vis card width=6 */\nselect 1").rewrite_vegalite("{}", false).unwrap();
    assert_eq!(&text[span.offset as usize..span.end() as usize], "vegalite\n   {}");
    let (text, span) = parsed_script("select 1").rewrite_vegalite("{}", false).unwrap();
    assert_eq!(&text[span.offset as usize..span.end() as usize], "/* @vis vegalite\n   {}\n*/\n");
}

#[test]
fn rewrite_vegalite_escapes_comment_delimiters() {
    let mut script = parsed_script("select 1");
    let (text, _) = script.rewrite_vegalite(r#"{"title": "a */ b /* c"}"#, false).unwrap();
    assert_eq!(text, "/* @vis vegalite\n   {\"title\": \"a *\\/ b /\\u002a c\"}\n*/\nselect 1");
    // The comment neither nests nor ends early, the spec reads back unchanged
    let catalog = Catalog::new();
    let mut written = Script::new(&catalog);
    written.replace_text(&text);
    written.analyze(&catalog, true).unwrap();
    let analyzed = written.analyzed.as_ref().unwrap();
    assert!(analyzed.parsed.scanned.errors.is_empty() && analyzed.parsed.errors.is_empty() && analyzed.errors.is_empty());
    assert_eq!(analyzed.visualization_specs[0].vegalite.as_ref().unwrap()["title"], "a */ b /* c");
}

#[test]
fn rewrite_vegalite_spans_lines_in_every_comment() {
    // A spec of several lines reads back unchanged behind the indentation, `-- ` and the ` * ` gutter
    let spec = r#"{"mark": "bar", "encoding": {"x": {"field": "a", "type": "nominal", "axis": {"title": "The first column of the query"}}}}"#;
    for before in ["/* @vis table */\n", "-- @vis table\n-- @end\n", "/*\n * @vis table\n */\n", "/** @vis table\n  * @vis card width=2 */\n"] {
        let (text, _) = parsed_script(&format!("{before}select 1 as a")).rewrite_vegalite(spec, false).unwrap();
        assert!(text.lines().count() > 3, "{text}");
        let catalog = Catalog::new();
        let mut written = Script::new(&catalog);
        written.replace_text(&text);
        written.analyze(&catalog, true).unwrap();
        let analyzed = written.analyzed.as_ref().unwrap();
        assert!(analyzed.parsed.errors.is_empty() && analyzed.errors.is_empty(), "{text}");
        let expected: serde_json::Value = serde_json::from_str(spec).unwrap();
        assert_eq!(analyzed.visualization_specs[0].vegalite.as_ref().unwrap(), expected.as_object().unwrap(), "{text}");
    }
}

#[test]
fn rewrite_vegalite_needs_a_terminal_query_and_a_json_object() {
    let not_parsed = Some(StatusCode::SCRIPT_NOT_PARSED);
    assert_eq!(parsed_script("").rewrite_vegalite("{}", false).unwrap_err().status, not_parsed);
    assert_eq!(parsed_script("select 1 +").rewrite_vegalite("{}", false).unwrap_err().status, not_parsed);
    let error = parsed_script("select 1; create table t (a int)").rewrite_vegalite("{}", false).unwrap_err();
    assert_eq!(error.message, "the last statement of the script is no query");
    let error = parsed_script("select 1").rewrite_vegalite("[1]", false).unwrap_err();
    assert_eq!(error.message, "the Vega-Lite spec is no JSON object");
    let error = parsed_script("select 1").rewrite_vegalite("{\"mark\":", false).unwrap_err();
    assert!(error.message.starts_with("the Vega-Lite spec is no valid JSON"), "{}", error.message);
}

#[test]
fn formatting_needs_a_parse_unless_requested() {
    use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
    let mut config = FormattingConfigT::default();
    config.dialect = FormattingDialect::HYPER;
    config.mode = FormattingMode::INLINE;
    config.max_width = 80;
    config.indentation_width = 4;

    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select   a ,b from   t");
    assert_eq!(script.format(&config, false).unwrap_err().status, Some(StatusCode::SCRIPT_NOT_PARSED));
    assert_eq!(script.format(&config, true).unwrap(), "select a, b from t;");
    assert_eq!(script.format_bytes(&config, false).unwrap(), b"select a, b from t;");
    assert!(script.is_fully_formattable(&config, false).unwrap());
    assert!(script.unformattable_nodes(&config, false).unwrap().is_empty());

    // A format of an outdated parse is refreshed on request
    script.replace_text("select 2");
    assert_eq!(script.format(&config, false).unwrap(), "select a, b from t;");
    assert_eq!(script.format(&config, true).unwrap(), "select 2;");
}

#[test]
fn formatting_copies_statements_with_syntax_errors() {
    use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode};
    let mut config = FormattingConfigT::default();
    config.dialect = FormattingDialect::HYPER;
    config.mode = FormattingMode::INLINE;
    config.max_width = 80;
    config.indentation_width = 4;

    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select   1; selec   2; select   3");
    // The broken statement stays as written instead of vanishing, but the script is not fully formatted
    assert_eq!(script.format(&config, true).unwrap(), "select 1;\n\nselec   2;\n\nselect 3;");
    assert!(!script.is_fully_formattable(&config, false).unwrap());
    assert!(script.unformattable_nodes(&config, false).unwrap().is_empty());

    script.replace_text("select   1; select   3");
    assert!(script.is_fully_formattable(&config, true).unwrap());
}

#[test]
fn statistics_describe_the_latest_analysis() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("create table t (a int); select a from t;");
    // Before the first analysis only the rope has a size
    let memory = script.memory_statistics();
    assert_eq!(memory.rope_bytes as usize, script.to_text().len());
    assert_eq!(memory.latest_script.scanner_input_bytes, 0);

    script.analyze(&catalog, true).unwrap();
    let statistics = script.statistics();
    let memory = statistics.memory.unwrap();
    assert_eq!(memory.rope_bytes as usize, script.to_text().len());
    assert_eq!(memory.latest_script.scanner_input_bytes as usize, script.to_text().len());
    assert!(memory.latest_script.scanner_symbol_bytes > 0);
    assert!(memory.latest_script.scanner_name_dictionary_bytes > 0);
    assert!(memory.latest_script.parser_ast_bytes > 0);
    assert!(memory.latest_script.analyzer_description_bytes > 0);
    assert!(statistics.timings.is_some());
    let timings = statistics.timings.as_ref().unwrap();
    assert_eq!(timings.scanner_last_elapsed, script.timings().scanner_ns);
    assert_eq!(timings.parser_last_elapsed, script.timings().parser_ns);
    assert_eq!(timings.analyzer_last_elapsed, script.timings().analyzer_ns);
}
