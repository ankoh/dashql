//! Tests of the structured SQL types: reading them from type names, their SQL text and their packing for the JS
//! bindings.

use dashql_buffers::analyzer::{ParameterKind as PackedParameterKind, SqlTypeKind as PackedSqlTypeKind};
use dashql_buffers::parser::IntervalType;
use dashql_core::analyzer::sql_types::{generic_kind, interval_keyword, parse_sql_type, SqlType, SqlTypeKind};
use dashql_core::catalog::Catalog;
use dashql_core::pack::{pack_analyzed_script, pack_sql_type};
use dashql_core::script::Script;
use dashql_core_session::visualize::pack_visualization;
use std::sync::Arc;

/// The SQL text of a parsed type
fn sql(text: &str) -> String {
    parse_sql_type(text).unwrap_or_else(|| panic!("no type: {text}")).to_string()
}

#[test]
fn types_print_their_canonical_names() {
    for (text, expected) in [
        ("boolean", "boolean"),
        ("bool", "boolean"),
        ("tinyint", "tinyint"),
        ("int1", "tinyint"),
        ("smallint", "smallint"),
        ("int2", "smallint"),
        ("int", "integer"),
        ("integer", "integer"),
        ("int4", "integer"),
        ("bigint", "bigint"),
        ("int8", "bigint"),
        ("real", "real"),
        ("float4", "real"),
        ("double precision", "double precision"),
        ("float8", "double precision"),
        ("double", "double precision"),
        ("numeric", "numeric"),
        ("numeric(10)", "numeric(10)"),
        ("numeric(10, 2)", "numeric(10,2)"),
        ("decimal(12,4)", "numeric(12,4)"),
        ("varchar", "varchar"),
        ("varchar(20)", "varchar(20)"),
        ("character varying(5)", "varchar(5)"),
        ("char(3)", "char(3)"),
        ("character", "char"),
        ("text", "text"),
        ("string", "text"),
        ("bit", "bit"),
        ("bit(4)", "bit(4)"),
        ("bit varying(8)", "bit varying(8)"),
        ("date", "date"),
        ("time", "time"),
        ("time(3)", "time(3)"),
        ("time with time zone", "time with time zone"),
        ("timetz", "time with time zone"),
        ("timestamp", "timestamp"),
        ("timestamp(6)", "timestamp(6)"),
        ("timestamp with time zone", "timestamp with time zone"),
        ("timestamptz", "timestamp with time zone"),
        ("interval", "interval"),
        ("interval day", "interval day"),
        ("interval year to month", "interval year to month"),
        ("interval day to second", "interval day to second"),
        ("interval second(3)", "interval second(3)"),
        ("json", "json"),
        ("Geography", "geography"),
        ("geography(4326)", "geography(4326)"),
        ("int[]", "integer[]"),
        ("int[][]", "integer[][]"),
        ("text array", "text[]"),
    ] {
        assert_eq!(sql(text), expected, "type: {text}");
    }
}

#[test]
fn types_parse_to_their_kinds() {
    let kind = |text: &str| parse_sql_type(text).unwrap().kind;
    assert_eq!(kind("numeric(10,2)"), SqlTypeKind::Numeric { precision: Some(10), scale: Some(2) });
    assert_eq!(kind("varchar(20)"), SqlTypeKind::Varchar { length: Some(20) });
    assert_eq!(kind("bit varying(8)"), SqlTypeKind::Bit { length: Some(8), varying: true });
    assert_eq!(kind("timestamp(3) with time zone"), SqlTypeKind::Timestamp { precision: Some(3), with_time_zone: true });
    assert_eq!(kind("interval day to second"), SqlTypeKind::Interval { fields: Some(IntervalType::DAY_TO_SECOND), precision: None });
    // A known generic name with modifiers stays generic
    assert_eq!(kind("text(5)"), SqlTypeKind::Generic { name: Arc::from("text"), modifiers: vec![Arc::from("5")] });
    assert_eq!(parse_sql_type("int[3]").unwrap().array_dimensions, 1);
}

#[test]
fn texts_that_are_no_single_type_have_none() {
    for text in ["", "int,", "int)::text", "int; select null::text", "("] {
        assert_eq!(parse_sql_type(text), None, "text: {text:?}");
    }
}

#[test]
fn type_predicates() {
    let ty = |text: &str| parse_sql_type(text).unwrap();
    assert!(ty("int").is_integer() && ty("int").is_numeric() && !ty("int").is_bool());
    assert!(ty("numeric(4,2)").is_numeric() && !ty("numeric(4,2)").is_integer());
    assert!(ty("real").is_numeric());
    assert!(ty("boolean").is_bool() && !ty("boolean").is_numeric());
    // Arrays are neither numbers nor booleans
    assert!(!ty("int[]").is_numeric() && !ty("int[]").is_integer());
    assert!(!ty("boolean[]").is_bool());
    assert!(!ty("text").is_numeric());
}

#[test]
fn generic_names_and_interval_keywords() {
    assert_eq!(generic_kind("int1"), Some(SqlTypeKind::Int1));
    assert_eq!(generic_kind("float8"), Some(SqlTypeKind::Float8));
    assert_eq!(generic_kind("json"), None);
    assert_eq!(interval_keyword(IntervalType::INTERVAL_SECOND), Some("second"));
    assert_eq!(interval_keyword(IntervalType::HOUR_TO_MINUTE), Some("hour to minute"));
    assert_eq!(interval_keyword(IntervalType::MINUTE_TO_SECOND), Some("minute to second"));
    assert_eq!(interval_keyword(IntervalType(99)), None);
    // Interval fields without a keyword print no field name
    let ty = SqlType::scalar(SqlTypeKind::Interval { fields: Some(IntervalType(99)), precision: None });
    assert_eq!(ty.to_string(), "interval ");
}

#[test]
fn types_pack_their_fields() {
    let pack = |text: &str| pack_sql_type(&parse_sql_type(text).unwrap());

    let t = pack("numeric(10,2)");
    assert_eq!((t.kind, t.precision, t.scale, t.length), (PackedSqlTypeKind::NUMERIC, 10, 2, -1));
    assert_eq!(t.sql.as_deref(), Some("numeric(10,2)"));
    let t = pack("numeric");
    assert_eq!((t.precision, t.scale), (-1, -1));

    let t = pack("varchar(20)");
    assert_eq!((t.kind, t.length), (PackedSqlTypeKind::VARCHAR, 20));
    let t = pack("char");
    assert_eq!((t.kind, t.length), (PackedSqlTypeKind::CHAR, -1));
    let t = pack("bit varying(8)");
    assert_eq!((t.kind, t.length, t.varying), (PackedSqlTypeKind::BIT, 8, true));

    let t = pack("time(3) with time zone");
    assert_eq!((t.kind, t.precision, t.with_time_zone), (PackedSqlTypeKind::TIME, 3, true));
    let t = pack("timestamp");
    assert_eq!((t.kind, t.precision, t.with_time_zone), (PackedSqlTypeKind::TIMESTAMP, -1, false));

    let t = pack("interval year to month");
    assert_eq!((t.kind, t.interval_fields, t.precision), (PackedSqlTypeKind::INTERVAL, IntervalType::YEAR_TO_MONTH.0 as i16, -1));
    let t = pack("interval");
    assert_eq!(t.interval_fields, -1);

    let t = pack("geography(4326, 'x')");
    assert_eq!(t.kind, PackedSqlTypeKind::GENERIC);
    assert_eq!(t.name.as_deref(), Some("geography"));
    assert_eq!(t.modifiers, Some(vec!["4326".to_string(), "'x'".to_string()]));
    let t = pack("json");
    assert_eq!((t.name.as_deref(), t.modifiers), (Some("json"), None));

    let t = pack("bigint[][]");
    assert_eq!((t.kind, t.array_dimensions), (PackedSqlTypeKind::INT8, 2));
    assert_eq!(t.sql.as_deref(), Some("bigint[][]"));

    for (text, kind) in [
        ("boolean", PackedSqlTypeKind::BOOL),
        ("tinyint", PackedSqlTypeKind::INT1),
        ("smallint", PackedSqlTypeKind::INT2),
        ("int", PackedSqlTypeKind::INT4),
        ("real", PackedSqlTypeKind::FLOAT4),
        ("double precision", PackedSqlTypeKind::FLOAT8),
        ("text", PackedSqlTypeKind::TEXT),
        ("date", PackedSqlTypeKind::DATE),
    ] {
        assert_eq!(pack(text).kind, kind, "type: {text}");
    }
}

#[test]
fn analyzed_scripts_pack_parameters() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("select * from :source where a > :min::numeric(10,2) and b = $1 and c = :name");
    script.analyze(&catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    let packed = pack_analyzed_script(&analyzed, &pack_visualization);
    let parameters = packed.parameters.unwrap();
    let summary: Vec<_> = parameters
        .iter()
        .map(|p| (p.kind, p.name.as_deref(), p.cast_type.as_ref().and_then(|t| t.sql.as_deref())))
        .collect();
    assert_eq!(
        summary,
        [
            (PackedParameterKind::TABLE, Some("source"), None),
            (PackedParameterKind::SCALAR, Some("min"), Some("numeric(10,2)")),
            (PackedParameterKind::SCALAR, Some("1"), None),
            (PackedParameterKind::SCALAR, Some("name"), None),
        ]
    );
    assert!(parameters.iter().all(|p| p.ast_statement_id == 0 && p.symbol_span.is_some()));
}
