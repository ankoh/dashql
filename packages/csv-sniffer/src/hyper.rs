//! The query that reads a scanned CSV file with the CSV reader of Hyper.
//!
//! Hyper reads a CSV file with `external(path, format => 'csv', columns => descriptor(...))`, it infers no schema of
//! a CSV file. A column that Hyper reads as it is gets its type in the descriptor. A typed column with NULL words or
//! quoted empty strings, or with dates that Hyper doesn't read, is read as `TEXT` and cast in the select list. The
//! path is a file that starts at the data offset of the format and ends at the data end of the schema: Hyper can't
//! skip a preamble.

use crate::scan::CsvSchema;
use crate::schema::Column;
use crate::sniff::CsvFormat;

/// A name as a quoted identifier
pub fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// A text as a string literal
pub fn quote_literal(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

/// A byte as a string literal, an escape string for one that is not printable
fn byte_literal(byte: u8) -> String {
    if byte.is_ascii_graphic() || byte == b' ' {
        quote_literal(&char::from(byte).to_string())
    } else {
        format!("E'\\x{byte:02x}'")
    }
}

/// The expression of a column in the select list
fn select_expression(column: &Column) -> String {
    let name = quote_identifier(&column.name);
    if !column.read_as_text() {
        return name;
    }
    let value = match column.date_format.pattern() {
        Some(pattern) => format!("to_date({name}, {})", quote_literal(pattern)),
        None => format!("CAST({name} AS {})", column.column_type.sql()),
    };
    if column.null_values.is_empty() {
        return format!("{value} AS {name}");
    }
    let nulls: Vec<String> = column.null_values.iter().map(|v| quote_literal(v)).collect();
    format!("CASE WHEN {name} IN ({}) THEN NULL ELSE {value} END AS {name}", nulls.join(", "))
}

/// The query that reads the CSV file at a path of Hyper
pub fn select_query(format: &CsvFormat, schema: &CsvSchema, path: &str) -> String {
    let select: Vec<String> = schema.columns.iter().map(|c| format!("    {}", select_expression(c))).collect();
    let descriptor: Vec<String> = schema
        .columns
        .iter()
        .map(|c| {
            let read_type = if c.read_as_text() { "TEXT" } else { c.column_type.sql() };
            format!("{} {read_type}", quote_identifier(&c.name))
        })
        .collect();
    // Without quoting the quote is a byte that a text file doesn't hold, Hyper wants one byte
    let quote = byte_literal(format.quote.unwrap_or(0x01));
    format!(
        "SELECT\n{}\nFROM external(\n    {},\n    format => 'csv',\n    header => {},\n    delimiter => {},\n    \
         quote => {quote},\n    columns => descriptor({})\n)",
        select.join(",\n"),
        quote_literal(path),
        format.has_header,
        byte_literal(format.delimiter),
        descriptor.join(", "),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::CsvScanner;
    use crate::sniff::sniff;

    fn query(data: &[u8]) -> String {
        let format = sniff(data, true).unwrap();
        let mut scanner = CsvScanner::new(format.clone(), 0);
        scanner.push(data);
        let (schema, _) = scanner.finish();
        select_query(&format, &schema, "/mnt/external/it's.csv")
    }

    #[test]
    fn test_native_columns() {
        let sql = query(b"id,name,when\n1,a,2024-01-31 10:00\n2,,2024-02-01 11:00\n3,c,2024-02-02 12:00\n");
        assert_eq!(
            sql,
            "SELECT\n    \"id\",\n    \"name\",\n    \"when\"\nFROM external(\n    '/mnt/external/it''s.csv',\n    \
             format => 'csv',\n    header => true,\n    delimiter => ',',\n    quote => '\"',\n    \
             columns => descriptor(\"id\" BIGINT, \"name\" TEXT, \"when\" TIMESTAMP)\n)"
        );
    }

    #[test]
    fn test_cast_columns() {
        let sql =
            query(b"n\tday\tok\n1\t31/01/2024\tyes\nNA\t01/02/2024\tno\n3\t15/02/2024\t\"\"\n4\t16/02/2024\tyes\n");
        assert!(
            sql.contains("    CASE WHEN \"n\" IN ('NA') THEN NULL ELSE CAST(\"n\" AS BIGINT) END AS \"n\",\n"),
            "{sql}"
        );
        assert!(sql.contains("    to_date(\"day\", 'DD/MM/YYYY') AS \"day\",\n"), "{sql}");
        assert!(
            sql.contains("    CASE WHEN \"ok\" IN ('') THEN NULL ELSE CAST(\"ok\" AS BOOLEAN) END AS \"ok\"\n"),
            "{sql}"
        );
        assert!(sql.contains("delimiter => E'\\x09'"), "{sql}");
        assert!(sql.contains("descriptor(\"n\" TEXT, \"day\" TEXT, \"ok\" TEXT)"), "{sql}");
    }

    #[test]
    fn test_identifiers_and_literals() {
        assert_eq!(quote_identifier("a \"b\""), "\"a \"\"b\"\"\"");
        assert_eq!(quote_literal("it's"), "'it''s'");
        assert_eq!(byte_literal(b'\''), "''''");
        assert_eq!(byte_literal(0x01), "E'\\x01'");
    }
}
