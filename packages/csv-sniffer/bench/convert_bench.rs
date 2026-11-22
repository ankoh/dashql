//! The throughput of the steps on a generated CSV file: `bazel run -c opt //packages/csv-sniffer:convert_bench [-- <MiB> [<parts>]]`.
//! The file has eight columns: an id, a price, a flag, a day, a timestamp, a name, a category and a quantity.

use std::time::Instant;

use csv_sniffer::convert::{plan_parts, PartConverter, PartPlan, MIN_PART_BYTES};
use csv_sniffer::reader::RecordReader;
use csv_sniffer::{sniff, CsvScanner};

fn generate(bytes: usize) -> Vec<u8> {
    let mut data = b"id,price,flag,day,at,name,category,qty\n".to_vec();
    let categories = ["books", "garden", "toys", "\"food, fresh\"", "tools"];
    let mut i: u64 = 0;
    while data.len() < bytes {
        let line = format!(
            "{i},{}.{:02},{},2024-{:02}-{:02},2024-{:02}-{:02} {:02}:{:02}:{:02},customer {},{},{}\n",
            i % 997,
            i % 100,
            if i % 3 == 0 { "true" } else { "false" },
            i % 12 + 1,
            i % 28 + 1,
            i % 12 + 1,
            i % 28 + 1,
            i % 24,
            i % 60,
            (i * 7) % 60,
            i % 10_000,
            categories.get((i % 5) as usize).copied().unwrap_or_default(),
            i % 50,
        );
        data.extend_from_slice(line.as_bytes());
        i += 1;
    }
    data
}

fn report(step: &str, bytes: usize, start: Instant) {
    let seconds = start.elapsed().as_secs_f64();
    println!("{step:<10} {:>8.1} ms {:>8.1} MiB/s", seconds * 1000.0, bytes as f64 / 1048576.0 / seconds);
}

fn main() {
    let mib: usize = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(256);
    let parts: usize = std::env::args().nth(2).and_then(|a| a.parse().ok()).unwrap_or(1);
    let data = generate(mib * 1024 * 1024);
    println!("{} MiB", data.len() / 1048576);

    let start = Instant::now();
    let format = sniff(data.get(..1 << 20).unwrap_or(&data), false).expect("sniff");
    report("sniff", 1 << 20, start);

    let start = Instant::now();
    let mut reader = RecordReader::new(format.delimiter, format.quote);
    let mut records = 0u64;
    let mut on_record = |_: &csv_sniffer::reader::Record<'_>| records += 1;
    reader.read(&data, &mut on_record);
    reader.finish(&mut on_record);
    report("records", data.len(), start);

    let start = Instant::now();
    let mut scanner = CsvScanner::new(format.clone(), 0);
    for chunk in data.chunks(4 << 20) {
        scanner.push(chunk);
    }
    let (schema, _) = scanner.finish();
    report("scan", data.len(), start);

    // The parts one after another, as workers would convert them at once
    let start = Instant::now();
    let plan = PartPlan::new(&format, &schema.columns);
    let mut rows = 0;
    let mut parquet = 0;
    for task in plan_parts(&format, data.len() as u64, parts, MIN_PART_BYTES) {
        let mut converter = PartConverter::new(format.clone(), plan.columns().expect("columns"), task).expect("part");
        let mut offset = converter.input_start() as usize;
        while offset < data.len() && !converter.done() {
            let end = (offset + (4 << 20)).min(data.len());
            parquet += converter.push(data.get(offset..end).unwrap_or_default()).len();
            offset = end;
        }
        let (tail, result) = converter.finish().expect("finish");
        parquet += tail.len();
        rows += result.rows;
    }
    report("convert", data.len(), start);
    println!("{rows} rows in {parts} parts, {} MiB of Parquet", parquet / 1048576);
}
