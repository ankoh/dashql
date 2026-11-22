//! The types that Hyper can read a value of a CSV field as.
//!
//! A value is classified into the set of types whose cast in Hyper accepts it, and a column takes the most specific
//! type that all its values share. The rules follow what Hyper accepts (checked against hyperdb-wasm, see
//! docs/design/csv_sniffer.md): integers and floats with surrounding spaces, the boolean words of PostgreSQL, dates as
//! `YYYY-MM-DD`, `YYYY/MM/DD` or `M/D/YYYY` (its date style is MDY), timestamps with a `T` or a space, a fraction, an
//! `AM`/`PM` and a zone. A day before the month (`D/M/YYYY`, `D.M.YYYY`) is no native date, the import reads it with
//! `to_date`.

/// Hyper reads the value as `BOOLEAN`
pub const BOOLEAN: u16 = 1 << 0;
/// Hyper reads the value as `BIGINT`
pub const BIGINT: u16 = 1 << 1;
/// Hyper reads the value as `DOUBLE PRECISION`
pub const DOUBLE: u16 = 1 << 2;
/// Hyper reads the value as `DATE`: `YYYY-MM-DD`, `YYYY/MM/DD` or `M/D/YYYY`
pub const DATE: u16 = 1 << 3;
/// The value is a date `D/M/YYYY`, read with `to_date(value, 'DD/MM/YYYY')`
pub const DATE_DMY: u16 = 1 << 4;
/// The value is a date `D.M.YYYY`, read with `to_date(value, 'DD.MM.YYYY')`
pub const DATE_DMY_DOTS: u16 = 1 << 5;
/// Hyper reads the value as `TIMESTAMP`: a native date, or a native date with a time
pub const TIMESTAMP: u16 = 1 << 6;
/// Every type
pub const ALL: u16 = BOOLEAN | BIGINT | DOUBLE | DATE | DATE_DMY | DATE_DMY_DOTS | TIMESTAMP;

/// The types a value can be read as
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ValueClass {
    /// The types, a set of the bits above, empty for text
    pub types: u16,
    /// Does the timestamp name a zone (`Z`, `+02:00`, `UTC`)? Then the column is a `TIMESTAMPTZ`.
    pub zoned: bool,
}

/// The words that mean a missing value in a field, adopted from csv-nose. The empty field is not among them, it is a
/// NULL in Hyper already when it is not quoted.
pub fn is_null_token(value: &[u8]) -> bool {
    matches!(
        value,
        b"-" | b"--"
            | b"."
            | b".."
            | b"?"
            | b"null"
            | b"NULL"
            | b"Null"
            | b"nil"
            | b"NIL"
            | b"Nil"
            | b"none"
            | b"NONE"
            | b"None"
            | b"na"
            | b"NA"
            | b"Na"
            | b"n/a"
            | b"N/A"
            | b"N/a"
            | b"nan"
            | b"NaN"
            | b"NAN"
            | b"#N/A"
            | b"#VALUE!"
            | b"#REF!"
            | b"#DIV/0!"
    )
}

/// The types that Hyper can read a non-empty value as
pub fn classify(value: &[u8]) -> ValueClass {
    let mut class = ValueClass::default();
    let trimmed = value.trim_ascii();
    if trimmed.is_empty() {
        return class;
    }
    match classify_number(trimmed) {
        Number::Integer => class.types |= BIGINT | DOUBLE,
        Number::Float => class.types |= DOUBLE,
        Number::None => {}
    }
    // The others are read without the spaces around them
    if trimmed.len() != value.len() {
        return class;
    }
    if is_boolean(value) {
        class.types |= BOOLEAN;
    }
    if value.first().is_some_and(u8::is_ascii_digit) {
        classify_temporal(value, &mut class);
    }
    class
}

/// Is the value a boolean word of PostgreSQL? `1` and `0` are, also as integers.
fn is_boolean(value: &[u8]) -> bool {
    const WORDS: [&[u8]; 12] = [b"true", b"false", b"t", b"f", b"yes", b"no", b"y", b"n", b"on", b"off", b"1", b"0"];
    WORDS.iter().any(|word| value.eq_ignore_ascii_case(word))
}

enum Number {
    None,
    Integer,
    Float,
}

/// Classify a number without the spaces around it. An integer fits into a `BIGINT`, a larger one is a float. A number
/// with a leading zero (`007`, a zip code or an id) is text, a number would lose the zero.
fn classify_number(value: &[u8]) -> Number {
    let unsigned = match value.first() {
        Some(b'+' | b'-') => value.get(1..).unwrap_or_default(),
        _ => value,
    };
    if unsigned.eq_ignore_ascii_case(b"inf") || unsigned.eq_ignore_ascii_case(b"infinity") {
        return Number::Float;
    }
    if value.eq_ignore_ascii_case(b"nan") {
        return Number::Float;
    }
    let digits = |bytes: &[u8]| bytes.iter().take_while(|b| b.is_ascii_digit()).count();
    let int_digits = digits(unsigned);
    let int_part = unsigned.get(..int_digits).unwrap_or_default();
    if int_part.len() > 1 && int_part.first() == Some(&b'0') {
        return Number::None;
    }
    let mut rest = unsigned.get(int_digits..).unwrap_or_default();
    if rest.is_empty() {
        if int_digits == 0 {
            return Number::None;
        }
        // A BIGINT has 19 digits, a larger integer is read as a float
        return match std::str::from_utf8(value).ok().and_then(|text| text.parse::<i64>().ok()) {
            Some(_) => Number::Integer,
            None => Number::Float,
        };
    }
    let mut fraction_digits = 0;
    if rest.first() == Some(&b'.') {
        rest = rest.get(1..).unwrap_or_default();
        fraction_digits = digits(rest);
        rest = rest.get(fraction_digits..).unwrap_or_default();
    }
    if int_digits + fraction_digits == 0 {
        return Number::None;
    }
    if let Some(b'e' | b'E') = rest.first() {
        rest = rest.get(1..).unwrap_or_default();
        if let Some(b'+' | b'-') = rest.first() {
            rest = rest.get(1..).unwrap_or_default();
        }
        let exponent_digits = digits(rest);
        if exponent_digits == 0 {
            return Number::None;
        }
        rest = rest.get(exponent_digits..).unwrap_or_default();
    }
    if rest.is_empty() {
        Number::Float
    } else {
        Number::None
    }
}

/// A reader of the bytes of a value
struct Cursor<'a> {
    bytes: &'a [u8],
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }

    fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.first().copied()
    }

    fn advance(&mut self, n: usize) {
        self.bytes = self.bytes.get(n..).unwrap_or_default();
    }

    /// Take the byte if it is the next one
    fn take(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.advance(1);
            true
        } else {
            false
        }
    }

    /// Take `min` to `max` digits as a number
    fn number(&mut self, min: usize, max: usize) -> Option<u32> {
        let count = self.bytes.iter().take(max).take_while(|b| b.is_ascii_digit()).count();
        if count < min {
            return None;
        }
        let value = self.bytes.get(..count)?.iter().fold(0u32, |n, b| n * 10 + u32::from(b - b'0'));
        self.advance(count);
        Some(value)
    }

    /// Take the word if it is next, ignoring the case
    fn word(&mut self, word: &[u8]) -> bool {
        match self.bytes.get(..word.len()) {
            Some(prefix) if prefix.eq_ignore_ascii_case(word) => {
                self.advance(word.len());
                true
            }
            _ => false,
        }
    }
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

/// Is it a day of the calendar?
fn is_valid_date(year: u32, month: u32, day: u32) -> bool {
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

/// A day of the calendar: year, month, day
type Ymd = (u32, u32, u32);

/// The dates that a value can be, by how it is written
#[derive(Default)]
struct DateParts {
    /// Hyper reads it natively: `YYYY-MM-DD`, `YYYY/MM/DD` or `M/D/YYYY`
    native: Option<Ymd>,
    /// `D/M/YYYY`
    dmy: Option<Ymd>,
    /// `D.M.YYYY`
    dmy_dots: Option<Ymd>,
}

/// The day if it is one of the calendar
fn valid(year: u32, month: u32, day: u32) -> Option<Ymd> {
    is_valid_date(year, month, day).then_some((year, month, day))
}

/// Read the date at the start of the value
fn read_date(cursor: &mut Cursor<'_>) -> Option<DateParts> {
    let mut parts = DateParts::default();
    let first = cursor.bytes.iter().take_while(|b| b.is_ascii_digit()).count();
    if first == 4 {
        // YYYY-MM-DD or YYYY/MM/DD
        let year = cursor.number(4, 4)?;
        let separator = cursor.peek().filter(|b| *b == b'-' || *b == b'/')?;
        cursor.advance(1);
        let month = cursor.number(1, 2)?;
        if !cursor.take(separator) {
            return None;
        }
        let day = cursor.number(1, 2)?;
        parts.native = valid(year, month, day);
    } else if first == 1 || first == 2 {
        // M/D/YYYY, D/M/YYYY or D.M.YYYY
        let a = cursor.number(1, 2)?;
        let separator = cursor.peek().filter(|b| *b == b'/' || *b == b'.')?;
        cursor.advance(1);
        let b = cursor.number(1, 2)?;
        if !cursor.take(separator) {
            return None;
        }
        let year = cursor.number(4, 4)?;
        if separator == b'/' {
            parts.native = valid(year, a, b);
            parts.dmy = valid(year, b, a);
        } else {
            parts.dmy_dots = valid(year, b, a);
        }
    } else {
        return None;
    }
    // A date is followed by nothing, a time or a digit that makes it no date
    if cursor.peek().is_some_and(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(parts)
}

/// Read a time `H:MM`, `H:MM:SS` or `H:MM:SS.fff` with an optional `AM` or `PM`, as microseconds of the day
fn read_time(cursor: &mut Cursor<'_>) -> Option<i64> {
    let hour = cursor.number(1, 2)?;
    if !cursor.take(b':') {
        return None;
    }
    let minute = cursor.number(2, 2)?;
    let mut second = 0;
    let mut micros = 0;
    if cursor.take(b':') {
        second = cursor.number(2, 2)?;
        if cursor.take(b'.') {
            let digits = cursor.bytes.iter().take(9).take_while(|b| b.is_ascii_digit()).count();
            let fraction = cursor.number(1, 9)?;
            // The first six digits are the microseconds
            micros = match digits {
                0..=6 => fraction * 10u32.pow(6 - digits as u32),
                _ => fraction / 10u32.pow(digits as u32 - 6),
            };
        }
    }
    if minute > 59 || second > 59 {
        return None;
    }
    let mut after_space = cursor.clone_bytes();
    after_space.take(b' ');
    let hour = if after_space.word(b"AM") {
        *cursor = after_space;
        if !(1..=12).contains(&hour) {
            return None;
        }
        hour % 12
    } else if after_space.word(b"PM") {
        *cursor = after_space;
        if !(1..=12).contains(&hour) {
            return None;
        }
        hour % 12 + 12
    } else if hour <= 23 {
        hour
    } else {
        return None;
    };
    Some(((i64::from(hour) * 60 + i64::from(minute)) * 60 + i64::from(second)) * 1_000_000 + i64::from(micros))
}

/// Read the zone of a timestamp: `Z`, `+HH`, `+HH:MM`, `+HHMM` or ` UTC`, as seconds east of UTC. A zone that is cut
/// off leaves the cursor in it, the value is no timestamp then.
fn read_zone(cursor: &mut Cursor<'_>) -> Option<i64> {
    if cursor.take(b'Z') || cursor.take(b'z') {
        return Some(0);
    }
    if let Some(sign @ (b'+' | b'-')) = cursor.peek() {
        cursor.advance(1);
        let hours = cursor.number(2, 2)?;
        let minutes = if cursor.take(b':') { cursor.number(2, 2)? } else { cursor.number(2, 2).unwrap_or(0) };
        if hours > 14 || minutes > 59 {
            return None;
        }
        let offset = i64::from(hours * 3600 + minutes * 60);
        return Some(if sign == b'-' { -offset } else { offset });
    }
    let mut after_space = cursor.clone_bytes();
    after_space.take(b' ');
    if after_space.word(b"UTC") || after_space.word(b"GMT") {
        *cursor = after_space;
        return Some(0);
    }
    None
}

impl Cursor<'_> {
    fn clone_bytes(&self) -> Self {
        Self { bytes: self.bytes }
    }
}

/// The days of a date since 1970-01-01
fn days_from_civil((year, month, day): Ymd) -> i32 {
    // Howard Hinnant's days_from_civil
    let y = i64::from(year) - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) as i32
}

/// A timestamp: the native date, the microseconds of the day and the zone
fn read_timestamp(value: &[u8]) -> Option<(Ymd, i64, Option<i64>)> {
    let mut cursor = Cursor::new(value);
    let date = read_date(&mut cursor)?.native?;
    if cursor.is_empty() {
        return Some((date, 0, None));
    }
    // Only a native date makes a native timestamp, a timestamp with the day first is text
    if !(cursor.take(b'T') || cursor.take(b' ')) {
        return None;
    }
    let time = read_time(&mut cursor)?;
    let zone = read_zone(&mut cursor);
    cursor.is_empty().then_some((date, time, zone))
}

/// Add the date and timestamp types of a value that starts with a digit
fn classify_temporal(value: &[u8], class: &mut ValueClass) {
    let mut cursor = Cursor::new(value);
    let Some(parts) = read_date(&mut cursor) else { return };
    if cursor.is_empty() {
        if parts.native.is_some() {
            class.types |= DATE | TIMESTAMP;
        }
        if parts.dmy.is_some() {
            class.types |= DATE_DMY;
        }
        if parts.dmy_dots.is_some() {
            class.types |= DATE_DMY_DOTS;
        }
        return;
    }
    if let Some((_, _, zone)) = read_timestamp(value) {
        class.types |= TIMESTAMP;
        class.zoned |= zone.is_some();
    }
}

/// The value of a `BIGINT`
pub fn parse_bigint(value: &[u8]) -> Option<i64> {
    let trimmed = value.trim_ascii();
    match classify_number(trimmed) {
        Number::Integer => std::str::from_utf8(trimmed).ok()?.parse().ok(),
        _ => None,
    }
}

/// The value of a `DOUBLE PRECISION`
pub fn parse_double(value: &[u8]) -> Option<f64> {
    let trimmed = value.trim_ascii();
    match classify_number(trimmed) {
        Number::Integer | Number::Float => std::str::from_utf8(trimmed).ok()?.parse().ok(),
        Number::None => None,
    }
}

/// The value of a `BOOLEAN`
pub fn parse_boolean(value: &[u8]) -> Option<bool> {
    const TRUE: [&[u8]; 6] = [b"true", b"t", b"yes", b"y", b"on", b"1"];
    const FALSE: [&[u8]; 6] = [b"false", b"f", b"no", b"n", b"off", b"0"];
    if TRUE.iter().any(|word| value.eq_ignore_ascii_case(word)) {
        Some(true)
    } else if FALSE.iter().any(|word| value.eq_ignore_ascii_case(word)) {
        Some(false)
    } else {
        None
    }
}

/// The value of a `DATE` written in a format, as days since 1970-01-01
pub fn parse_date(value: &[u8], format: crate::schema::DateFormat) -> Option<i32> {
    use crate::schema::DateFormat;
    let mut cursor = Cursor::new(value);
    let parts = read_date(&mut cursor)?;
    if !cursor.is_empty() {
        return None;
    }
    let date = match format {
        DateFormat::Native => parts.native,
        DateFormat::DayMonthYear => parts.dmy,
        DateFormat::DayMonthYearDots => parts.dmy_dots,
    }?;
    Some(days_from_civil(date))
}

/// The value of a `TIMESTAMP` as microseconds since 1970-01-01, in UTC if it names a zone
pub fn parse_timestamp(value: &[u8]) -> Option<i64> {
    let (date, time, zone) = read_timestamp(value)?;
    Some(i64::from(days_from_civil(date)) * 86_400_000_000 + time - zone.unwrap_or(0) * 1_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types(value: &str) -> u16 {
        classify(value.as_bytes()).types
    }

    #[test]
    fn test_numbers() {
        assert_eq!(types("42"), BIGINT | DOUBLE);
        assert_eq!(types("-42"), BIGINT | DOUBLE);
        assert_eq!(types("+3"), BIGINT | DOUBLE);
        assert_eq!(types(" 12 "), BIGINT | DOUBLE);
        assert_eq!(types("9223372036854775807"), BIGINT | DOUBLE);
        assert_eq!(types("9223372036854775808"), DOUBLE);
        assert_eq!(types("1.5"), DOUBLE);
        assert_eq!(types(".5"), DOUBLE);
        assert_eq!(types("1."), DOUBLE);
        assert_eq!(types("1e5"), DOUBLE);
        assert_eq!(types("-2.5E-3"), DOUBLE);
        assert_eq!(types("NaN"), DOUBLE);
        assert_eq!(types("-Infinity"), DOUBLE);
        assert_eq!(types("0.5"), DOUBLE);
        assert_eq!(types("0"), BIGINT | DOUBLE | BOOLEAN);
        assert_eq!(types("007"), 0);
        assert_eq!(types("1,5"), 0);
        assert_eq!(types("1e"), 0);
        assert_eq!(types("."), 0);
        assert_eq!(types("-"), 0);
        assert_eq!(types("12abc"), 0);
    }

    #[test]
    fn test_booleans() {
        for word in ["true", "FALSE", "t", "F", "yes", "No", "y", "n", "on", "off"] {
            assert_eq!(types(word), BOOLEAN, "{word}");
        }
        assert_eq!(types("1"), BIGINT | DOUBLE | BOOLEAN);
        assert_eq!(types(" true"), 0);
        assert_eq!(types("truth"), 0);
    }

    #[test]
    fn test_dates() {
        assert_eq!(types("2024-01-31"), DATE | TIMESTAMP);
        assert_eq!(types("2024/1/3"), DATE | TIMESTAMP);
        assert_eq!(types("2024-02-30"), 0);
        assert_eq!(types("2024-02-29"), DATE | TIMESTAMP);
        assert_eq!(types("2023-02-29"), 0);
        assert_eq!(types("01/31/2024"), DATE | TIMESTAMP);
        assert_eq!(types("31/01/2024"), DATE_DMY);
        assert_eq!(types("01/02/2024"), DATE | TIMESTAMP | DATE_DMY);
        assert_eq!(types("31.01.2024"), DATE_DMY_DOTS);
        assert_eq!(types("3.1.2024"), DATE_DMY_DOTS);
        assert_eq!(types("2024-01-31x"), 0);
        assert_eq!(types("20240131"), BIGINT | DOUBLE);
        assert_eq!(types("1/2/24"), 0);
        assert_eq!(types("2024-01"), 0);
    }

    #[test]
    fn test_timestamps() {
        assert_eq!(types("2024-01-31 10:00"), TIMESTAMP);
        assert_eq!(types("2024-01-31T10:00:00"), TIMESTAMP);
        assert_eq!(types("2024-01-31T10:00:00.123456"), TIMESTAMP);
        assert_eq!(types("01/31/2024 10:00 PM"), TIMESTAMP);
        assert_eq!(types("2024-01-31 25:00"), 0);
        assert_eq!(types("2024-01-31 10:60"), 0);
        assert_eq!(types("31/01/2024 10:00"), 0);
        assert_eq!(types("2024-01-31 10:00:00 extra"), 0);
        for zoned in [
            "2024-01-31T10:00:00Z",
            "2024-01-31 10:00:00.123+02",
            "2024-01-31 10:00:00+0530",
            "2024-01-31 10:00:00 UTC",
        ] {
            let class = classify(zoned.as_bytes());
            assert_eq!(class.types, TIMESTAMP, "{zoned}");
            assert!(class.zoned, "{zoned}");
        }
        assert!(!classify(b"2024-01-31 10:00:00").zoned);
    }

    #[test]
    fn test_text_and_nulls() {
        assert_eq!(types("hello"), 0);
        assert_eq!(types(""), 0);
        assert_eq!(types("   "), 0);
        assert!(is_null_token(b"NA"));
        assert!(is_null_token(b"#N/A"));
        assert!(!is_null_token(b""));
        assert!(!is_null_token(b"nope"));
    }

    #[test]
    fn test_parse_values() {
        use crate::schema::DateFormat;
        assert_eq!(parse_bigint(b" -42 "), Some(-42));
        assert_eq!(parse_bigint(b"1.5"), None);
        assert_eq!(parse_double(b"2.5e3"), Some(2500.0));
        assert_eq!(parse_double(b"7"), Some(7.0));
        assert!(parse_double(b"NaN").is_some_and(f64::is_nan));
        assert_eq!(parse_boolean(b"Yes"), Some(true));
        assert_eq!(parse_boolean(b"0"), Some(false));
        assert_eq!(parse_boolean(b"maybe"), None);
        assert_eq!(parse_date(b"1970-01-01", DateFormat::Native), Some(0));
        assert_eq!(parse_date(b"2024-01-31", DateFormat::Native), Some(19753));
        assert_eq!(parse_date(b"01/31/2024", DateFormat::Native), Some(19753));
        assert_eq!(parse_date(b"31/01/2024", DateFormat::DayMonthYear), Some(19753));
        assert_eq!(parse_date(b"31.01.2024", DateFormat::DayMonthYearDots), Some(19753));
        assert_eq!(parse_date(b"1969-12-31", DateFormat::Native), Some(-1));
        assert_eq!(parse_date(b"31/01/2024", DateFormat::Native), None);
        let day = 19753 * 86_400_000_000i64;
        assert_eq!(parse_timestamp(b"2024-01-31"), Some(day));
        assert_eq!(parse_timestamp(b"2024-01-31 10:00:00.5"), Some(day + 36_000_500_000));
        assert_eq!(parse_timestamp(b"01/31/2024 10:00 PM"), Some(day + 79_200_000_000));
        assert_eq!(parse_timestamp(b"01/31/2024 12:15 AM"), Some(day + 900_000_000));
        assert_eq!(parse_timestamp(b"2024-01-31T10:00:00+02:00"), Some(day + 28_800_000_000));
        assert_eq!(parse_timestamp(b"2024-01-31T10:00:00.123456789Z"), Some(day + 36_000_123_456));
        assert_eq!(parse_timestamp(b"2024-01-31T10:00:00-0530"), Some(day + 55_800_000_000));
        assert_eq!(parse_timestamp(b"31/01/2024 10:00"), None);
    }
}
