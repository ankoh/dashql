//! Instants as milliseconds since the epoch: the timestamps of responses and the ISO text of tokens.

/// The milliseconds of a day
const DAY_MS: i64 = 86_400_000;
/// The largest instant that JavaScript dates hold
const MAX_DATE_MS: i64 = 8_640_000_000_000_000;

/// The days since the epoch of a civil date, Howard Hinnant's algorithm
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * month_index + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil date of days since the epoch
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

/// The days of a month
fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// The milliseconds of a wall clock time in UTC. Fields out of range carry over, as they do in `Date.UTC`.
fn utc_ms(year: i64, month: i64, day: i64, hours: i64, minutes: i64, seconds: i64, ms: i64) -> Option<i64> {
    let year = year.checked_add((month - 1).div_euclid(12))?;
    let month = (month - 1).rem_euclid(12) + 1;
    let days = days_from_civil(year, month, 1).checked_add(day - 1)?;
    let out = days.checked_mul(DAY_MS)?.checked_add(((hours * 60 + minutes) * 60 + seconds) * 1000 + ms)?;
    (out.abs() <= MAX_DATE_MS).then_some(out)
}

/// The ISO 8601 text of an instant with milliseconds, as `Date.toISOString` writes it
pub fn iso_timestamp(ms: i64) -> String {
    let days = ms.div_euclid(DAY_MS);
    let time = ms.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    let year = if (0..=9999).contains(&year) { format!("{year:04}") } else { format!("{year:+07}") };
    format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1_000 % 60,
        time % 1_000
    )
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

/// Parse an instant as `Date.parse` reads the ISO text of tokens, none if it isn't one
pub fn parse_iso_ms(text: &str) -> Option<i64> {
    parse_timestamp_ms(text).or_else(|| parse_date_days(text).map(|days| i64::from(days) * DAY_MS))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(parse_iso_ms("2000-01-01T00:00:00Z"), Some(946_684_800_000));
        assert_eq!(iso_timestamp(1_800_000_000_000), "2027-01-15T08:00:00.000Z");
    }
}
