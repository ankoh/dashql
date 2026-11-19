//! Civil dates and ISO 8601 timestamps in milliseconds since the epoch, without a time zone database.

/// Milliseconds since the Unix epoch
pub type Millis = i64;

/// The milliseconds of a day
pub const DAY_MS: i64 = 86_400_000;

/// The largest distance of a JavaScript date from the epoch, a date beyond it is invalid
pub const MAX_DATE_MS: i64 = 8_640_000_000_000_000;

/// The days since the epoch of a civil date, Howard Hinnant's algorithm. The month is 1 to 12.
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil date of the days since the epoch: year, month 1 to 12, day 1 to 31
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
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

/// The milliseconds since the epoch of a wall clock time in UTC. Like `Date.setUTCFullYear` and
/// `Date.setUTCHours`, fields beyond their range carry over, e.g. month 13 is January of the next year. None if the
/// time is beyond the range of a JavaScript date.
pub fn utc_ms(year: i64, month: i64, day: i64, hours: i64, minutes: i64, seconds: i64, ms: i64) -> Option<Millis> {
    let month_index = month.checked_sub(1)?;
    let year = year.checked_add(month_index.div_euclid(12))?;
    let month = month_index.rem_euclid(12) + 1;
    // Beyond about 270,000 years a date is invalid anyway, this keeps the arithmetic in range
    if year.abs() > 1_000_000 {
        return None;
    }
    let days = days_from_civil(year, month, 1).checked_add(day.checked_sub(1)?)?;
    let time = hours
        .checked_mul(3_600_000)?
        .checked_add(minutes.checked_mul(60_000)?)?
        .checked_add(seconds.checked_mul(1_000)?)?
        .checked_add(ms)?;
    let total = days.checked_mul(DAY_MS)?.checked_add(time)?;
    (total.abs() <= MAX_DATE_MS).then_some(total)
}

/// A timestamp of the clock of the host in ISO 8601, see `iso_timestamp`. The milliseconds are floored, a time that
/// isn't finite is the epoch.
pub fn iso_timestamp_f64(ms: f64) -> String {
    iso_timestamp(if ms.is_finite() { ms.floor() as i64 } else { 0 })
}

/// A timestamp in ISO 8601 with milliseconds, e.g. `2026-01-01T00:00:00.000Z`, like `Date.toISOString`: a year
/// outside of 0 to 9999 has six digits and a sign
pub fn iso_timestamp(ms: Millis) -> String {
    let days = ms.div_euclid(DAY_MS);
    let time = ms.rem_euclid(DAY_MS);
    let (year, month, day) = civil_from_days(days);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1_000 % 60,
        time % 1_000
    )
}

/// Parse the digits of a string as a number, none if it is empty or has other characters
fn digits(text: &str) -> Option<i64> {
    if text.is_empty() || text.len() > 18 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Parse an ISO 8601 timestamp in UTC or with an offset, e.g. `2026-01-01T00:00:00.000Z`, as `Date.toISOString`
/// writes it. None for other texts.
pub fn parse_iso_timestamp(text: &str) -> Option<Millis> {
    let (date, time) = text.split_once('T')?;
    let (sign, date) = match date.as_bytes().first()? {
        b'+' => (1, date.get(1..)?),
        b'-' => (-1, date.get(1..)?),
        _ => (1, date),
    };
    let mut parts = date.splitn(3, '-');
    let year = sign * digits(parts.next()?)?;
    let month = digits(parts.next()?)?;
    let day = digits(parts.next()?)?;
    // The zone: Z or an offset
    let (clock, offset_ms) = if let Some(clock) = time.strip_suffix('Z') {
        (clock, 0)
    } else {
        let at = time.rfind(['+', '-'])?;
        let (clock, offset) = time.split_at(at);
        let negative = offset.starts_with('-');
        let offset = offset.get(1..)?;
        let (hours, minutes) = match offset.split_once(':') {
            Some(split) => split,
            None => (offset.get(..2)?, offset.get(2..)?),
        };
        let offset = (digits(hours)? * 60 + digits(minutes)?) * 60_000;
        (clock, if negative { -offset } else { offset })
    };
    let (clock, fraction) = clock.split_once('.').unwrap_or((clock, ""));
    let mut fields = clock.splitn(3, ':');
    let hours = digits(fields.next()?)?;
    let minutes = digits(fields.next()?)?;
    let seconds = fields.next().map(digits).unwrap_or(Some(0))?;
    let ms = if fraction.is_empty() {
        0
    } else {
        let millis: String = fraction.chars().chain("00".chars()).take(3).collect();
        digits(&millis)?
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hours > 24 || minutes > 59 || seconds > 59 {
        return None;
    }
    utc_ms(year, month, day, hours, minutes, seconds, ms).map(|ms| ms - offset_ms)
}
