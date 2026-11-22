//! The sniffer on the NYC 311 sample of csv-nose: 200 rows of 41 columns, timestamps with AM/PM, zip codes, ids,
//! coordinates and quoted points

use csv_sniffer::{sniff, ColumnType, CsvScanner};

const NYC_311: &[u8] = include_bytes!("data/nyc_311_sample_200.csv");

#[test]
fn test_nyc_311_sample() {
    let format = sniff(NYC_311, true).unwrap();
    assert_eq!((format.delimiter, format.quote, format.has_header, format.columns), (b',', Some(b'"'), true, 41));
    let mut scanner = CsvScanner::new(format, 5);
    for chunk in NYC_311.chunks(1000) {
        scanner.push(chunk);
    }
    let (schema, _) = scanner.finish();
    assert_eq!(schema.rows, 200);
    assert!(schema.problems.is_empty(), "{:?}", schema.problems);
    assert_eq!(schema.preview.len(), 5);
    let column = |name: &str| schema.columns.iter().find(|c| c.name == name).unwrap();
    assert_eq!(column("Unique Key").column_type, ColumnType::BigInt);
    assert_eq!(column("Created Date").column_type, ColumnType::Timestamp);
    assert_eq!(column("Agency").column_type, ColumnType::Text);
    assert_eq!(column("Latitude").column_type, ColumnType::Double);
    assert_eq!(column("Location").column_type, ColumnType::Text);
}
