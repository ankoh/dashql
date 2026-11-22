//! The CSV sniffer of DashQL: finds the schema of a CSV file so that the CSV reader of Hyper can read it, which
//! infers none. See docs/design/csv_sniffer.md.
//!
//! 1. `sniff` finds the format from the first bytes of a file: the encoding, the dialect (delimiter, quote, header)
//!    with the Table Uniformity Method of csv-nose (`dialect`), and where the data starts after a preamble.
//! 2. `CsvScanner` reads the whole file in chunks of any size, decodes a file that is no UTF-8, and finds the type of
//!    every column, the rows that Hyper can't read and the first rows as a preview (`CsvSchema`).
//! 3. `select_query` is the query that reads the file with Hyper in the schema.
//!
//! The crate is built into a wasm module of its own (`bindings/lib.rs`), which reads the files of the browser.

pub mod convert;
pub mod dialect;
pub mod hyper;
pub mod reader;
pub mod scan;
pub mod schema;
pub mod sniff;
pub mod value;

pub use hyper::select_query;
pub use scan::{CsvScanner, CsvSchema};
pub use schema::{Column, ColumnType, DateFormat};
pub use sniff::{sniff, CsvFormat};
