//! The result pages of Trino as Arrow: the types of the columns, the rows of a page as a record batch.
//!
//! Trino writes the rows of a page as JSON arrays. A value that doesn't fit its column is null, a value of a type
//! without an Arrow translation is a string, complex values (arrays, maps, rows) are their JSON text. The conversions
//! coerce values the way JavaScript does: a boolean column takes any truthy value, an integer column takes numeric
//! strings.
//!
//! A timestamp with a named time zone needs the offsets of the zone, the crate has no time zone database: the host
//! knows them (`Intl` in the browser) and implements `TimeZoneOffsets`.

use std::collections::HashMap;
use std::sync::Arc;

use arrow_array::types::{
    Date32Type, Date64Type, Float32Type, Float64Type, Int16Type, Int32Type, Int64Type, Int8Type, Time32MillisecondType,
    TimestampMillisecondType,
};
use arrow_array::{ArrayRef, BinaryArray, BooleanArray, Decimal128Array, PrimitiveArray, RecordBatch, StringArray};
use arrow_schema::{DataType, Field, Schema, SchemaRef, TimeUnit};
use serde_json::Value;

use super::error::{TrinoError, TrinoResult};
use crate::http::base64::base64_decode;
use super::protocol::TrinoColumn;
use super::time::{utc_ms, Millis, DAY_MS, MAX_DATE_MS};

/// The offsets of named time zones, e.g. `Europe/Berlin`
pub trait TimeZoneOffsets {
    /// The offset of a zone at an instant in milliseconds: the wall clock in the zone minus the wall clock in UTC.
    /// None for an unknown zone.
    fn offset_ms(&self, zone: &str, instant: Millis) -> Option<i64>;
}

/// Knows no named zones: a timestamp with a named zone other than UTC is null
#[derive(Debug, Clone, Copy, Default)]
pub struct NoTimeZones;

impl TimeZoneOffsets for NoTimeZones {
    fn offset_ms(&self, _zone: &str, _instant: Millis) -> Option<i64> {
        None
    }
}

/// The zones that are UTC
const UTC_ZONES: [&str; 8] = ["UTC", "Z", "GMT", "Etc/UTC", "Etc/GMT", "UCT", "Zulu", "Universal"];

/// The offsets that a conversion looked up, by zone and minute. Cleared when it grows too large.
#[derive(Default)]
pub struct ZoneOffsetCache {
    offsets: HashMap<(String, i64), Option<i64>>,
}

/// The entries of a zone offset cache before it is cleared
const ZONE_OFFSET_CACHE_SIZE: usize = 100_000;

impl ZoneOffsetCache {
    /// The offset of a named zone at the minute of an instant
    fn offset_ms(&mut self, zones: &dyn TimeZoneOffsets, zone: &str, instant: Millis) -> Option<i64> {
        let minute = instant.div_euclid(60_000);
        if let Some(offset) = self.offsets.get(&(zone.to_string(), minute)) {
            return *offset;
        }
        let offset = zones.offset_ms(zone, minute.saturating_mul(60_000));
        if self.offsets.len() >= ZONE_OFFSET_CACHE_SIZE {
            self.offsets.clear();
        }
        self.offsets.insert((zone.to_string(), minute), offset);
        offset
    }
}

/// The Arrow type of a Trino type. Types without a translation are strings.
pub fn parse_trino_type(type_name: &str) -> DataType {
    let lower = type_name.trim().to_lowercase();
    let ty = lower.as_str();
    match ty {
        "boolean" => return DataType::Boolean,
        "tinyint" => return DataType::Int8,
        "smallint" => return DataType::Int16,
        "integer" | "int" => return DataType::Int32,
        "bigint" => return DataType::Int64,
        "real" => return DataType::Float32,
        "double" => return DataType::Float64,
        "decimal" => return DataType::Decimal128(38, 0),
        "varbinary" => return DataType::Binary,
        "date" => return DataType::Date32,
        _ => {}
    }
    if let Some(args) = ty.strip_prefix("decimal(").and_then(|rest| rest.strip_suffix(')')) {
        // decimal(precision, scale), a precision beyond 38 doesn't fit 128 bits and stays a string
        let parsed = args.split_once(',').and_then(|(precision, scale)| {
            let precision = precision.trim_end();
            let scale = scale.trim_start();
            let all_digits = |text: &str| !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit());
            if !all_digits(precision) || !all_digits(scale) {
                return None;
            }
            Some((precision.parse::<u8>().ok()?, scale.parse::<i8>().ok()?))
        });
        return match parsed {
            Some((precision, scale)) if (1..=38).contains(&precision) && scale <= precision as i8 => {
                DataType::Decimal128(precision, scale)
            }
            _ => DataType::Utf8,
        };
    }
    if ty == "time" || ty.starts_with("time(") || ty == "time with time zone" {
        return DataType::Time32(TimeUnit::Millisecond);
    }
    if ty == "timestamp" || ty.starts_with("timestamp(") || ty.starts_with("timestamp ") {
        let zone: Option<Arc<str>> = ty.contains("with time zone").then(|| Arc::from("UTC"));
        return DataType::Timestamp(TimeUnit::Millisecond, zone);
    }
    // Strings, JSON, intervals, UUIDs, IP addresses, complex types as JSON text and unknown types
    DataType::Utf8
}

/// The Arrow schema of the result columns, every field is nullable
pub fn trino_schema(columns: &[TrinoColumn]) -> SchemaRef {
    let fields: Vec<Field> =
        columns.iter().map(|column| Field::new(column.name.clone(), parse_trino_type(&column.type_name), true)).collect();
    Arc::new(Schema::new(fields))
}

/// Translate the rows of a result page to a record batch of a schema. A row that is no array or lacks a column has
/// nulls there.
pub fn rows_to_record_batch(schema: &SchemaRef, rows: &[Value], zones: &dyn TimeZoneOffsets) -> TrinoResult<RecordBatch> {
    let mut cache = ZoneOffsetCache::default();
    let mut columns: Vec<ArrayRef> = Vec::with_capacity(schema.fields().len());
    for (index, field) in schema.fields().iter().enumerate() {
        let values = rows.iter().map(|row| match row.get(index) {
            Some(Value::Null) | None => None,
            Some(value) => Some(value),
        });
        columns.push(column_array(field.data_type(), values, zones, &mut cache)?);
    }
    // A field of a type without a translation holds strings
    let schema = if schema.fields().iter().all(|field| is_translated(field.data_type())) {
        schema.clone()
    } else {
        let fields: Vec<Field> = schema
            .fields()
            .iter()
            .map(|field| {
                let data_type = if is_translated(field.data_type()) { field.data_type().clone() } else { DataType::Utf8 };
                Field::new(field.name().clone(), data_type, true)
            })
            .collect();
        Arc::new(Schema::new(fields))
    };
    let options = arrow_array::RecordBatchOptions::new().with_row_count(Some(rows.len()));
    RecordBatch::try_new_with_options(schema, columns, &options)
        .map_err(|e| TrinoError::protocol(format!("Invalid record batch: {e}")))
}

/// Does a column of a type get an array of the type? Columns of other types get strings.
fn is_translated(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Boolean
            | DataType::Int8
            | DataType::Int16
            | DataType::Int32
            | DataType::Int64
            | DataType::Float32
            | DataType::Float64
            | DataType::Decimal128(_, _)
            | DataType::Date32
            | DataType::Date64
            | DataType::Time32(TimeUnit::Millisecond)
            | DataType::Timestamp(TimeUnit::Millisecond, _)
            | DataType::Binary
            | DataType::Utf8
    )
}

/// The array of the values of a column, a missing value is none
fn column_array<'a>(
    data_type: &DataType,
    values: impl Iterator<Item = Option<&'a Value>>,
    zones: &dyn TimeZoneOffsets,
    cache: &mut ZoneOffsetCache,
) -> TrinoResult<ArrayRef> {
    let array: ArrayRef = match data_type {
        DataType::Boolean => Arc::new(values.map(|v| v.map(js_truthy)).collect::<BooleanArray>()),
        DataType::Int8 => Arc::new(values.map(|v| v.and_then(js_number).map(|n| js_to_int32(n) as i8)).collect::<PrimitiveArray<Int8Type>>()),
        DataType::Int16 => {
            Arc::new(values.map(|v| v.and_then(js_number).map(|n| js_to_int32(n) as i16)).collect::<PrimitiveArray<Int16Type>>())
        }
        DataType::Int32 => Arc::new(values.map(|v| v.and_then(js_number).map(js_to_int32)).collect::<PrimitiveArray<Int32Type>>()),
        DataType::Int64 => Arc::new(values.map(|v| v.and_then(big_int)).collect::<PrimitiveArray<Int64Type>>()),
        DataType::Float32 => {
            Arc::new(values.map(|v| v.and_then(js_number).map(|n| n as f32)).collect::<PrimitiveArray<Float32Type>>())
        }
        DataType::Float64 => Arc::new(values.map(|v| v.and_then(js_number)).collect::<PrimitiveArray<Float64Type>>()),
        DataType::Decimal128(precision, scale) => {
            let scale_digits = usize::try_from(*scale).unwrap_or(0);
            values
                .map(|v| v.and_then(|v| unscaled_decimal(v, scale_digits)))
                .collect::<Decimal128Array>()
                .with_precision_and_scale(*precision, *scale)
                .map(|array| Arc::new(array) as ArrayRef)
                .map_err(|e| TrinoError::protocol(format!("Invalid decimal type: {e}")))?
        }
        DataType::Date32 => Arc::new(
            values
                .map(|v| v.and_then(date_ms).map(|ms| ms.div_euclid(DAY_MS) as i32))
                .collect::<PrimitiveArray<Date32Type>>(),
        ),
        DataType::Date64 => Arc::new(values.map(|v| v.and_then(date_ms)).collect::<PrimitiveArray<Date64Type>>()),
        DataType::Time32(TimeUnit::Millisecond) => {
            Arc::new(values.map(|v| v.map(time_ms)).collect::<PrimitiveArray<Time32MillisecondType>>())
        }
        DataType::Timestamp(TimeUnit::Millisecond, zone) => {
            let array = values
                .map(|v| {
                    let text = match v? {
                        Value::String(text) if text.is_empty() => return None,
                        Value::String(text) => text.clone(),
                        other => js_string(other),
                    };
                    parse_trino_timestamp_ms_cached(&text, zones, cache)
                })
                .collect::<PrimitiveArray<TimestampMillisecondType>>();
            Arc::new(array.with_timezone_opt(zone.clone()))
        }
        DataType::Binary => {
            let bytes: Vec<Option<Vec<u8>>> = values
                .map(|v| match v {
                    // Trino writes varbinary as base64
                    Some(Value::String(text)) => base64_decode(text),
                    _ => None,
                })
                .collect();
            Arc::new(bytes.iter().map(|b| b.as_deref()).collect::<BinaryArray>())
        }
        // Strings and all other types, complex values as their JSON text
        _ => Arc::new(
            values
                .map(|v| {
                    v.map(|value| match value {
                        Value::String(text) => text.clone(),
                        other => js_string(other),
                    })
                })
                .collect::<StringArray>(),
        ),
    };
    Ok(array)
}

/// The truth of a value like `Boolean(value)`
fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// The number of a value like `Number(value)`, none for NaN and an empty string
fn js_number(value: &Value) -> Option<f64> {
    let number = match value {
        Value::Null => return None,
        Value::String(s) if s.is_empty() => return None,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => js_string_to_number(s),
        Value::Array(_) | Value::Object(_) => f64::NAN,
    };
    (!number.is_nan()).then_some(number)
}

/// Is a character white space for `Number(text)`?
fn is_js_whitespace(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// The number of a string like `Number(text)`: decimal literals, `0x`, `0o` and `0b` integers and `Infinity`, an
/// empty string is 0, anything else is NaN
fn js_string_to_number(text: &str) -> f64 {
    let text = text.trim_matches(is_js_whitespace);
    if text.is_empty() {
        return 0.0;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = text.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0.0, |acc, c| acc * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0)));
        }
    }
    // Rust also reads `inf` and `nan`, JavaScript doesn't
    let decimal = text.bytes().all(|b| b.is_ascii_digit() || b"+-.eE".contains(&b));
    if !decimal {
        return f64::NAN;
    }
    text.parse::<f64>().unwrap_or(f64::NAN)
}

/// A number as a 32-bit integer like the `ToInt32` of JavaScript: truncated and wrapped, NaN and the infinities are 0
fn js_to_int32(number: f64) -> i32 {
    if !number.is_finite() {
        return 0;
    }
    let wrapped = number.trunc().rem_euclid(4_294_967_296.0);
    (wrapped as u32) as i32
}

/// The value of a bigint column like `BigInt(value)` wrapped to 64 bits: integers, numeric strings and booleans, none
/// for fractions and other strings
fn big_int(value: &Value) -> Option<i64> {
    match value {
        Value::Null => None,
        Value::Bool(b) => Some(i64::from(*b)),
        Value::Number(n) => {
            if let Some(n) = n.as_i64() {
                return Some(n);
            }
            if let Some(n) = n.as_u64() {
                return Some(n as i64);
            }
            let n = n.as_f64()?;
            if !n.is_finite() || n.fract() != 0.0 {
                return None;
            }
            // Wrapped like a BigInt64Array
            let wrapped = n.rem_euclid(18_446_744_073_709_551_616.0);
            Some((wrapped as u64) as i64)
        }
        Value::String(text) => {
            if text.is_empty() {
                return None;
            }
            string_to_big_int(text.trim_matches(is_js_whitespace))
        }
        Value::Array(_) | Value::Object(_) => None,
    }
}

/// The integer of a string like `BigInt(text)` wrapped to 64 bits: decimal with an optional sign, or `0x`, `0o` and
/// `0b` without sign. White space only is 0.
fn string_to_big_int(text: &str) -> Option<i64> {
    if text.is_empty() {
        return Some(0);
    }
    let (radix, digits, negative) = if let Some(digits) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        (16, digits, false)
    } else if let Some(digits) = text.strip_prefix("0o").or_else(|| text.strip_prefix("0O")) {
        (8, digits, false)
    } else if let Some(digits) = text.strip_prefix("0b").or_else(|| text.strip_prefix("0B")) {
        (2, digits, false)
    } else if let Some(digits) = text.strip_prefix('-') {
        (10, digits, true)
    } else {
        (10, text.strip_prefix('+').unwrap_or(text), false)
    };
    if digits.is_empty() {
        return None;
    }
    let mut value: u64 = 0;
    for c in digits.chars() {
        let digit = c.to_digit(radix)?;
        value = value.wrapping_mul(u64::from(radix)).wrapping_add(u64::from(digit));
    }
    let value = if negative { value.wrapping_neg() } else { value };
    Some(value as i64)
}

/// The unscaled value of a decimal with a number of digits after the point: the digits of the text of the value. None
/// if the value has more digits after the point or doesn't fit 128 bits.
fn unscaled_decimal(value: &Value, scale: usize) -> Option<i128> {
    let text = match value {
        Value::String(text) if text.is_empty() => return None,
        Value::String(text) => text.trim_matches(is_js_whitespace).to_string(),
        other => js_string(other),
    };
    let (negative, unsigned) = match text.as_bytes().first() {
        Some(b'-') => (true, text.get(1..)?),
        Some(b'+') => (false, text.get(1..)?),
        _ => (false, text.as_str()),
    };
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let all_digits = |part: &str| part.bytes().all(|b| b.is_ascii_digit());
    if !all_digits(whole) || !all_digits(fraction) || (whole.is_empty() && fraction.is_empty()) {
        return None;
    }
    if fraction.len() > scale {
        return None;
    }
    // The digits of the value times 10^scale, in the range of i128
    let mut unscaled: i128 = 0;
    for digit in whole.bytes().chain(fraction.bytes()).chain(std::iter::repeat_n(b'0', scale - fraction.len())) {
        let digit = i128::from(digit - b'0');
        unscaled = unscaled.checked_mul(10)?;
        unscaled = if negative { unscaled.checked_sub(digit)? } else { unscaled.checked_add(digit)? };
    }
    Some(unscaled)
}

/// The milliseconds since epoch of a date: a date `YYYY-MM-DD` in UTC, or a number of milliseconds
fn date_ms(value: &Value) -> Option<Millis> {
    match value {
        Value::Number(n) => {
            let ms = n.as_f64()?;
            (ms.is_finite() && ms.abs() <= MAX_DATE_MS as f64).then(|| ms.trunc() as i64)
        }
        Value::String(text) => {
            let (negative, rest) = match text.as_bytes().first() {
                Some(b'-') => (true, text.get(1..)?),
                Some(b'+') => (false, text.get(1..)?),
                _ => (false, text.as_str()),
            };
            let mut parts = rest.split('-');
            let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
            let fixed = |part: &str, len: usize| part.len() == len && part.bytes().all(|b| b.is_ascii_digit());
            if parts.next().is_some()
                || !(year.len() == 4 || (year.len() == 6 && rest.len() != text.len()))
                || !year.bytes().all(|b| b.is_ascii_digit())
                || !fixed(month, 2)
                || !fixed(day, 2)
            {
                return None;
            }
            let year: i64 = year.parse().ok()?;
            let year = if negative { -year } else { year };
            let (month, day): (i64, i64) = (month.parse().ok()?, day.parse().ok()?);
            if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
                return None;
            }
            utc_ms(year, month, day, 0, 0, 0, 0)
        }
        _ => None,
    }
}

/// The days of a month of a year
fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// The leading integer of a text like `parseInt(text, 10)`, none for NaN
fn parse_int_prefix(text: &str) -> Option<f64> {
    let text = text.trim_start_matches(is_js_whitespace);
    let (negative, rest) = match text.as_bytes().first() {
        Some(b'-') => (true, text.get(1..)?),
        Some(b'+') => (false, text.get(1..)?),
        _ => (false, text),
    };
    let digits = rest.get(..rest.bytes().take_while(u8::is_ascii_digit).count())?;
    if digits.is_empty() {
        return None;
    }
    let value = digits.bytes().fold(0.0, |acc, b| acc * 10.0 + f64::from(b - b'0'));
    Some(if negative { -value } else { value })
}

/// The milliseconds since midnight of a time `HH:MM:SS.sss`, missing parts are 0 and a time zone is ignored
fn time_ms(value: &Value) -> i32 {
    let text = match value {
        Value::String(text) => text.clone(),
        other => js_string(other),
    };
    let mut parts = text.split(':');
    let hours = parts.next().and_then(parse_int_prefix).unwrap_or(0.0);
    let minutes = parts.next().and_then(parse_int_prefix).unwrap_or(0.0);
    let seconds_text = parts.next().filter(|s| !s.is_empty()).unwrap_or("0");
    let (seconds, fraction) = seconds_text.split_once('.').unwrap_or((seconds_text, ""));
    let seconds = parse_int_prefix(seconds).unwrap_or(0.0);
    let fraction = if fraction.is_empty() { "0" } else { fraction };
    let millis: String = fraction.chars().chain(std::iter::repeat('0')).take(3).collect();
    // A fraction that is no number makes the whole time NaN, which a 32-bit array stores as 0
    let Some(millis) = parse_int_prefix(&millis) else {
        return 0;
    };
    js_to_int32(((hours * 60.0 + minutes) * 60.0 + seconds) * 1000.0 + millis)
}

/// The fields of a Trino timestamp: `2024-03-01 12:30:00.123`, with time zone followed by ` UTC`, ` +01:00` or
/// ` Europe/Berlin`
struct TimestampParts<'a> {
    year: i64,
    month: i64,
    day: i64,
    hours: i64,
    minutes: i64,
    seconds: i64,
    millis: i64,
    zone: Option<&'a str>,
}

/// A run of digits of a length, the length 0 for one or more digits
fn take_digits(text: &str, len: usize) -> Option<(&str, &str)> {
    let count = text.bytes().take_while(u8::is_ascii_digit).count();
    if count == 0 || (len > 0 && count != len) {
        return None;
    }
    Some(text.split_at(count))
}

/// Parse the fields of a Trino timestamp
fn timestamp_parts(text: &str) -> Option<TimestampParts<'_>> {
    let (negative, rest) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (year, rest) = take_digits(rest, 0)?;
    let rest = rest.strip_prefix('-')?;
    let (month, rest) = take_digits(rest, 2)?;
    let rest = rest.strip_prefix('-')?;
    let (day, rest) = take_digits(rest, 2)?;
    let rest = rest.strip_prefix(' ').or_else(|| rest.strip_prefix('T'))?;
    let (hours, rest) = take_digits(rest, 2)?;
    let rest = rest.strip_prefix(':')?;
    let (minutes, rest) = take_digits(rest, 2)?;
    let rest = rest.strip_prefix(':')?;
    let (seconds, mut rest) = take_digits(rest, 2)?;
    let mut fraction = "";
    if let Some(after_point) = rest.strip_prefix('.') {
        let (digits, after) = take_digits(after_point, 0)?;
        fraction = digits;
        rest = after;
    }
    let zone = if rest.is_empty() {
        None
    } else {
        let zone = rest.strip_prefix(' ').unwrap_or(rest);
        if zone.is_empty() || zone.chars().any(char::is_whitespace) {
            return None;
        }
        Some(zone)
    };
    let millis: String = fraction.chars().chain(std::iter::repeat('0')).take(3).collect();
    // A year beyond i64 is out of range of a date anyway
    let year: i64 = year.parse().ok()?;
    Some(TimestampParts {
        year: if negative { -year } else { year },
        month: month.parse().ok()?,
        day: day.parse().ok()?,
        hours: hours.parse().ok()?,
        minutes: minutes.parse().ok()?,
        seconds: seconds.parse().ok()?,
        millis: millis.parse().ok()?,
        zone,
    })
}

/// Parse a Trino timestamp to milliseconds since epoch, none if it is invalid. A timestamp without time zone is a
/// wall clock time and stays as is, one with a time zone is moved to UTC.
pub fn parse_trino_timestamp_ms(text: &str, zones: &dyn TimeZoneOffsets) -> Option<Millis> {
    parse_trino_timestamp_ms_cached(text, zones, &mut ZoneOffsetCache::default())
}

/// Parse a Trino timestamp with a cache of the offsets of named zones
fn parse_trino_timestamp_ms_cached(text: &str, zones: &dyn TimeZoneOffsets, cache: &mut ZoneOffsetCache) -> Option<Millis> {
    let parts = timestamp_parts(text)?;
    let wall = utc_ms(parts.year, parts.month, parts.day, parts.hours, parts.minutes, parts.seconds, parts.millis)?;
    let Some(zone) = parts.zone else {
        return Some(wall);
    };
    if UTC_ZONES.contains(&zone) {
        return Some(wall);
    }
    if let Some(offset) = zone_offset(zone) {
        return Some(wall - offset);
    }
    // Guess the instant with the offset at the wall clock, then correct it with the offset at the guess
    let guess = wall - cache.offset_ms(zones, zone, wall)?;
    Some(wall - cache.offset_ms(zones, zone, guess)?)
}

/// The milliseconds of a zone offset like `+01:00` or `-0530`
fn zone_offset(zone: &str) -> Option<i64> {
    let sign = match zone.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let rest = zone.get(1..)?;
    let (hours, rest) = take_digits(rest, 2)?;
    let rest = rest.strip_prefix(':').unwrap_or(rest);
    let (minutes, rest) = take_digits(rest, 2)?;
    if !rest.is_empty() {
        return None;
    }
    let hours: i64 = hours.parse().ok()?;
    let minutes: i64 = minutes.parse().ok()?;
    Some(sign * (hours * 60 + minutes) * 60_000)
}

/// The text of a value like `String(value)` of JavaScript, arrays and objects as `JSON.stringify` writes them
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => js_number_text(n),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => {
            let mut out = String::new();
            write_json(value, &mut out);
            out
        }
    }
}

/// Write a value as JSON like `JSON.stringify`: numbers as JavaScript writes them, integers with all their digits
fn write_json(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&js_number_text(n)),
        Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap_or_default()),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json(item, out);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            out.push('{');
            for (i, (key, item)) in fields.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).unwrap_or_default());
                out.push(':');
                write_json(item, out);
            }
            out.push('}');
        }
    }
}

/// The text of a JSON number: an integer with all its digits, a float as JavaScript writes it
fn js_number_text(n: &serde_json::Number) -> String {
    if n.is_i64() || n.is_u64() {
        return n.to_string();
    }
    n.as_f64().map(js_number_string).unwrap_or_else(|| n.to_string())
}

/// A number as `Number.prototype.toString` writes it: the shortest digits that read back, with an exponent below
/// 1e-6 and from 1e21
pub fn js_number_string(number: f64) -> String {
    if number.is_nan() {
        return "NaN".into();
    }
    if number.is_infinite() {
        return if number > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if number == 0.0 {
        return "0".into();
    }
    let sign = if number < 0.0 { "-" } else { "" };
    // The shortest digits that read back, e.g. `1.2345e3`
    let scientific = format!("{:e}", number.abs());
    let Some((mantissa, exponent)) = scientific.split_once('e') else {
        return scientific;
    };
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let Ok(exponent) = exponent.parse::<i64>() else {
        return scientific;
    };
    let k = digits.len() as i64;
    // The value is 0.digits * 10^n
    let n = exponent + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (whole, fraction) = digits.split_at(n as usize);
        format!("{whole}.{fraction}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let exponent_sign = if n > 0 { "+" } else { "-" };
        let (first, rest) = digits.split_at(1);
        let rest = if rest.is_empty() { String::new() } else { format!(".{rest}") };
        format!("{first}{rest}e{exponent_sign}{}", (n - 1).abs())
    };
    format!("{sign}{body}")
}
