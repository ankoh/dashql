//! Instants as milliseconds since the epoch and dates as days, as the values of responses have them.

use crate::time::{days_from_civil, utc_ms};

/// The days of a month
fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Read a run of digits, at least `min` and at most `max` of them
fn digits(text: &str, min: usize, max: usize) -> Option<(i64, &str)> {
    let end = text.bytes().take(max).take_while(u8::is_ascii_digit).count();
    if end < min {
        return None;
    }
    let (number, rest) = text.split_at(end);
    Some((number.parse().ok()?, rest))
}

/// The zones that are UTC
const UTC_ZONES: [&str; 8] = ["UTC", "Z", "GMT", "Etc/UTC", "Etc/GMT", "UCT", "Zulu", "Universal"];

/// The offset of a zone like `+01:00` or `-0500` in milliseconds
fn zone_offset_ms(zone: &str) -> Option<i64> {
    let sign = match zone.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let rest = zone.get(1..)?;
    let (hours, rest) = digits(rest, 2, 2)?;
    let rest = rest.strip_prefix(':').unwrap_or(rest);
    let (minutes, rest) = digits(rest, 2, 2)?;
    rest.is_empty().then_some(sign * (hours * 60 + minutes) * 60_000)
}

/// Parse a timestamp such as `2024-03-01 12:30:00.123`, `2024-03-01T12:30:00Z` or `2024-03-01T12:30:00+01:00` to
/// milliseconds since the epoch, none if it is invalid. A timestamp without a zone is a wall clock time in UTC. Named
/// zones other than UTC are not known.
pub fn parse_timestamp_ms(text: &str) -> Option<i64> {
    let (negative, rest) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (year, rest) = digits(rest, 1, 9)?;
    let year = if negative { -year } else { year };
    let (month, rest) = digits(rest.strip_prefix('-')?, 2, 2)?;
    let (day, rest) = digits(rest.strip_prefix('-')?, 2, 2)?;
    let rest = rest.strip_prefix(['T', ' '])?;
    let (hours, rest) = digits(rest, 2, 2)?;
    let (minutes, rest) = digits(rest.strip_prefix(':')?, 2, 2)?;
    let (seconds, rest) = digits(rest.strip_prefix(':')?, 2, 2)?;
    let (fraction, rest) = match rest.strip_prefix('.') {
        Some(rest) => {
            let end = rest.bytes().take_while(u8::is_ascii_digit).count();
            if end == 0 {
                return None;
            }
            let (fraction, rest) = rest.split_at(end);
            let ms: String = fraction.chars().chain("000".chars()).take(3).collect();
            (ms.parse::<i64>().ok()?, rest)
        }
        None => (0, rest),
    };
    let zone = rest.strip_prefix(' ').unwrap_or(rest);
    if zone.contains(char::is_whitespace) {
        return None;
    }
    let wall = utc_ms(year, month, day, hours, minutes, seconds, fraction)?;
    if zone.is_empty() || UTC_ZONES.contains(&zone) {
        return Some(wall);
    }
    let offset = zone_offset_ms(zone)?;
    Some(wall - offset)
}

/// Parse a date `YYYY-MM-DD` to days since the epoch, none if it isn't a valid day
pub fn parse_date_days(text: &str) -> Option<i32> {
    let (year, rest) = digits(text, 4, 4)?;
    let (month, rest) = digits(rest.strip_prefix('-')?, 2, 2)?;
    let (day, rest) = digits(rest.strip_prefix('-')?, 2, 2)?;
    if !rest.is_empty() || !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    i32::try_from(days_from_civil(year, month, day)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::iso_timestamp;

    #[test]
    fn reads_and_writes_iso_text() {
        assert_eq!(iso_timestamp(1_767_225_600_000), "2026-01-01T00:00:00.000Z");
        assert_eq!(parse_timestamp_ms("2026-01-01T00:00:00.000Z"), Some(1_767_225_600_000));
        assert_eq!(parse_timestamp_ms("2024-03-11T09:01:22.000+0000"), parse_timestamp_ms("2024-03-11T09:01:22Z"));
        assert_eq!(parse_timestamp_ms("2024-03-11T10:01:22+01:00"), parse_timestamp_ms("2024-03-11 09:01:22 UTC"));
        assert_eq!(parse_timestamp_ms("2024-03-11"), None);
        assert_eq!(parse_timestamp_ms("2024-03-11T09:01:22 Europe/Berlin"), None);
        assert_eq!(parse_date_days("1970-01-02"), Some(1));
        assert_eq!(parse_date_days("2024-02-30"), None);
        assert_eq!(iso_timestamp(1_800_000_000_000), "2027-01-15T08:00:00.000Z");
    }
}
