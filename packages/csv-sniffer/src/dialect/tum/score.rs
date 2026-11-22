//! Combined scoring for dialect detection.
//!
//! The gamma score combines uniformity and type detection scores
//! to rank potential CSV dialects.

use super::potential_dialects::PotentialDialect;
use super::table::{parse_table, parse_table_normalized, Table};
use super::type_detection::{calculate_pattern_score, calculate_type_score, TypeScoreBuffers};
use super::uniformity::{calculate_tau_0, calculate_tau_1, is_uniform};

/// Count one at an index of the counts, an index out of them counts nothing
fn bump(counts: &mut [usize], index: usize) {
    if let Some(count) = counts.get_mut(index) {
        *count += 1;
    }
}

/// Pre-computed quote character counts for the data.
/// Used to avoid redundant byte counting across multiple dialect evaluations.
#[derive(Debug, Clone, Copy)]
struct QuoteCounts {
    double: usize,
    single: usize,
    /// Number of `\'` (backslash + single-quote) byte pairs in the data.
    backslash_single: usize,
    /// Number of `\"` (backslash + double-quote) byte pairs in the data.
    backslash_double: usize,
    data_len: usize,
}

impl QuoteCounts {
    fn new(data: &[u8]) -> Self {
        let mut backslash_single = 0usize;
        let mut backslash_double = 0usize;
        for window in data.windows(2) {
            let [w0, w1] = *window else { continue };
            if w0 == b'\\' {
                if w1 == b'\'' {
                    backslash_single += 1;
                } else if w1 == b'"' {
                    backslash_double += 1;
                }
            }
        }
        Self {
            double: data.iter().filter(|&&b| b == b'"').count(),
            single: data.iter().filter(|&&b| b == b'\'').count(),
            backslash_single,
            backslash_double,
            data_len: data.len(),
        }
    }
}

/// Pre-computed quote boundary counts for both quote characters.
/// Used to avoid redundant data scanning across multiple dialect evaluations.
#[derive(Debug, Clone)]
struct QuoteBoundaryCounts {
    /// Boundary counts for double quote with each delimiter (opening + closing)
    double_boundaries: Vec<(u8, usize)>,
    /// Boundary counts for single quote with each delimiter (opening + closing)
    single_boundaries: Vec<(u8, usize)>,
    /// Opening-only boundary counts for single quote with each delimiter
    /// (delimiter/newline → quote, field start).  Used to distinguish genuine
    /// quoting from apostrophes that appear only before delimiters (closing).
    single_opening_boundaries: Vec<(u8, usize)>,
    /// Newline boundary counts for double quote (not delimiter-specific)
    double_newline_boundaries: usize,
    /// Newline boundary counts for single quote (not delimiter-specific)
    single_newline_boundaries: usize,
    /// Opening-only newline boundary counts for single quote
    single_opening_newline_boundaries: usize,
    /// Whether data starts with double quote
    starts_with_double: bool,
    /// Whether data starts with single quote
    starts_with_single: bool,
}

impl QuoteBoundaryCounts {
    /// Compute quote boundary counts for all delimiters in a single pass.
    fn new(data: &[u8], delimiters: &[u8]) -> Self {
        let mut double_counts: Vec<usize> = vec![0; delimiters.len()];
        let mut single_counts: Vec<usize> = vec![0; delimiters.len()];
        let mut single_opening_counts: Vec<usize> = vec![0; delimiters.len()];
        let mut double_newline_boundaries: usize = 0;
        let mut single_newline_boundaries: usize = 0;
        let mut single_opening_newline_boundaries: usize = 0;

        // Create lookup table for delimiter indices
        let mut delim_indices = [usize::MAX; 256];
        for (i, &d) in delimiters.iter().enumerate() {
            if let Some(index) = delim_indices.get_mut(usize::from(d)) {
                *index = i;
            }
        }

        // Single pass through data for all delimiters
        for window in data.windows(2) {
            let [w0, w1] = *window else { continue };
            let is_newline = w0 == b'\n' || w0 == b'\r';
            let delim_idx = delim_indices.get(usize::from(w0)).copied().unwrap_or(usize::MAX);
            let is_delimiter = delim_idx != usize::MAX;

            // Quote after delimiter/newline (field start = OPENING boundary)
            if is_newline || is_delimiter {
                if w1 == b'"' {
                    if is_newline {
                        // Count newline boundaries separately (once, not per delimiter)
                        double_newline_boundaries += 1;
                    } else {
                        // Count delimiter-specific boundary
                        bump(&mut double_counts, delim_idx);
                    }
                }
                if w1 == b'\'' {
                    if is_newline {
                        single_newline_boundaries += 1;
                        single_opening_newline_boundaries += 1;
                    } else {
                        bump(&mut single_counts, delim_idx);
                        bump(&mut single_opening_counts, delim_idx);
                    }
                }
            }

            // Quote before delimiter/newline (field end = CLOSING boundary)
            let is_end_newline = w1 == b'\n' || w1 == b'\r';
            let end_delim_idx = delim_indices.get(usize::from(w1)).copied().unwrap_or(usize::MAX);
            let is_end_delimiter = end_delim_idx != usize::MAX;

            if w0 == b'"' && (is_end_newline || is_end_delimiter) {
                if is_end_newline {
                    double_newline_boundaries += 1;
                } else {
                    bump(&mut double_counts, end_delim_idx);
                }
            }
            if w0 == b'\'' && (is_end_newline || is_end_delimiter) {
                if is_end_newline {
                    single_newline_boundaries += 1;
                } else {
                    bump(&mut single_counts, end_delim_idx);
                }
            }
        }

        let starts_with_double = data.first() == Some(&b'"');
        let starts_with_single = data.first() == Some(&b'\'');

        Self {
            double_boundaries: delimiters.iter().copied().zip(double_counts).collect(),
            single_boundaries: delimiters.iter().copied().zip(single_counts).collect(),
            single_opening_boundaries: delimiters.iter().copied().zip(single_opening_counts).collect(),
            double_newline_boundaries,
            single_newline_boundaries,
            single_opening_newline_boundaries,
            starts_with_double,
            starts_with_single,
        }
    }

    /// Get the boundary count for a specific quote character and delimiter.
    fn get_boundary_count(&self, quote_char: u8, delimiter: u8) -> usize {
        let (boundaries, newline_boundaries) = if quote_char == b'"' {
            (&self.double_boundaries, self.double_newline_boundaries)
        } else {
            (&self.single_boundaries, self.single_newline_boundaries)
        };

        let delimiter_count = boundaries.iter().find(|&&(d, _)| d == delimiter).map_or(0, |&(_, c)| c);

        // Add 1 if data starts with this quote char
        let starts_with_quote =
            (quote_char == b'"' && self.starts_with_double) || (quote_char == b'\'' && self.starts_with_single);
        let start_bonus = usize::from(starts_with_quote);

        // Combine delimiter-specific count with newline boundaries (which apply to all delimiters)
        delimiter_count + newline_boundaries + start_bonus
    }

    /// Get the opening-only boundary count for single-quote with a given delimiter.
    ///
    /// Opening boundaries are delimiter/newline → single-quote transitions (field starts).
    /// This distinguishes genuine single-quote quoting (both opening and closing boundaries)
    /// from apostrophes that appear only before delimiters (closing only, as in `'value',`).
    fn get_single_opening_boundary_count(&self, delimiter: u8) -> usize {
        let delimiter_count =
            self.single_opening_boundaries.iter().find(|&&(d, _)| d == delimiter).map_or(0, |&(_, c)| c);

        // starts_with_single is an opening boundary (file-start → single-quote)
        let start_bonus = usize::from(self.starts_with_single);

        delimiter_count + self.single_opening_newline_boundaries + start_bonus
    }
}

/// Score result for a dialect.
#[derive(Debug, Clone)]
pub struct DialectScore {
    /// The potential dialect that was scored.
    pub dialect: PotentialDialect,
    /// The combined gamma score (higher is better).
    pub gamma: f64,
    /// Consistency score (tau_0).
    #[allow(dead_code)]
    pub tau_0: f64,
    /// Dispersion score (tau_1).
    #[allow(dead_code)]
    pub tau_1: f64,
    /// Type detection score.
    #[allow(dead_code)]
    pub type_score: f64,
    /// Pattern specificity score.
    #[allow(dead_code)]
    pub pattern_score: f64,
    /// Number of rows parsed.
    #[allow(dead_code)]
    pub num_rows: usize,
    /// Modal (most common) field count.
    pub num_fields: usize,
    /// Whether the table has uniform field counts.
    pub is_uniform: bool,
}

/// Below this many parsed rows, a space delimiter carries an extra penalty.
/// Space is the one candidate that is overwhelmingly likely to be incidental
/// text spacing rather than structure, and a handful of rows does not provide
/// enough repetition to tell the two apart. Genuinely space-delimited files in
/// the wild are column-aligned data dumps with many rows.
const SPACE_MIN_CONFIDENT_ROWS: usize = 5;

/// Minimum rows in a parsed table before a preamble window is considered.
const PREAMBLE_MIN_ROWS: usize = 8;
/// Minimum number of leading rows that must be discarded. A single deviating
/// leading row is ordinary title/header variance, not a non-tabular preamble;
/// forgiving it would hand every candidate a cheap uniformity boost.
const PREAMBLE_MIN_TRIM: usize = 2;
/// At most `1 / PREAMBLE_MAX_TRIM_FRAC_INV` of the rows may be discarded.
const PREAMBLE_MAX_TRIM_FRAC_INV: usize = 4;
/// A discarded row may hold at most `1 / PREAMBLE_MAX_FIELD_RATIO` of the modal
/// field count. This is the guard that makes the rule safe: it forbids
/// discarding any row with >= 25% of the modal field count, which necessarily
/// excludes every modal row, so an interior non-modal blip can never cascade
/// into a large trim.
const PREAMBLE_MAX_FIELD_RATIO: usize = 4;
/// Minimum surviving rows in the window.
const PREAMBLE_MIN_WINDOW: usize = 5;

/// Find a scoring window `[start, end)` in which *every* row has the modal
/// field count, discarding a guarded non-tabular leading block and at most one
/// truncated trailing record.
///
/// This lets a candidate whose field-count variance is entirely attributable to
/// a leading preamble (e.g. `$$veh_info` / `key=[...]` metadata lines above a
/// real table) be scored on the tabular part, instead of having its uniformity
/// destroyed by rows that are not data under any delimiter.
///
/// Returns `None` when no qualifying window exists, which is the common case.
///
/// INVARIANT: every row in the returned window equals `modal_field_count()`.
/// Callers rely on this to substitute `tau_0 = tau_1 = 1.0` exactly. Widening
/// this window to admit non-modal rows would make that substitution wrong and
/// require a real slice-based tau computation instead.
fn all_modal_window(table: &Table) -> Option<(usize, usize)> {
    let fc = &table.field_counts;
    let n = fc.len();
    let modal = table.modal_field_count();

    // Cheap rejects first: this runs for all 33 candidates on a hot path.
    if n < PREAMBLE_MIN_ROWS || modal < 2 {
        return None;
    }

    // `read_sample` can cut the sample mid-record (Records(N) estimates a byte
    // count from a newline sample), so forgive at most one short trailing row.
    let end = if fc.last().is_some_and(|&last| last < modal) { n - 1 } else { n };

    // Walk back over the maximal all-modal suffix.
    let mut start = end;
    while start > 0 && fc.get(start - 1) == Some(&modal) {
        start -= 1;
    }

    if start < PREAMBLE_MIN_TRIM || start * PREAMBLE_MAX_TRIM_FRAC_INV > n || end - start < PREAMBLE_MIN_WINDOW {
        return None;
    }

    // Discarded rows must be structurally unrelated to the data rows, not
    // merely ragged. `c == 0` is rejected so the ratio test is never vacuous.
    if fc.get(..start).unwrap_or_default().iter().any(|&c| c == 0 || c * PREAMBLE_MAX_FIELD_RATIO > modal) {
        return None;
    }

    Some((start, end))
}

impl DialectScore {
    /// Create a new score result.
    pub fn new(dialect: PotentialDialect, table: &Table, type_score: f64) -> Self {
        // When a qualifying all-modal window exists, the candidate's field-count
        // variance comes from a non-tabular leading preamble (plus at most one
        // truncated trailing record), not from the delimiter being wrong. Score
        // uniformity on that window. Because the window is all-modal *by
        // construction*, tau_0 and tau_1 are exactly 1.0 - an identity, not an
        // approximation. See `all_modal_window`.
        let (tau_0, tau_1) = if all_modal_window(table).is_some() {
            (1.0, 1.0)
        } else {
            (calculate_tau_0(table), calculate_tau_1(table))
        };
        let pattern_score = calculate_pattern_score(table);
        let uniform = is_uniform(table);

        // Calculate combined gamma score (includes delimiter penalty)
        let gamma = compute_gamma(tau_0, tau_1, type_score, pattern_score, table, dialect.delimiter);

        Self {
            dialect,
            gamma,
            tau_0,
            tau_1,
            type_score,
            pattern_score,
            num_rows: table.num_rows(),
            num_fields: table.modal_field_count(),
            is_uniform: uniform,
        }
    }

    /// Re-target a score to another dialect that parses `table` identically.
    ///
    /// Only gamma depends on the dialect (via the delimiter penalty), so this
    /// equals `DialectScore::new(dialect, table, self.type_score)` without
    /// recomputing the table-wide uniformity, type and pattern statistics.
    fn for_dialect(&self, dialect: PotentialDialect, table: &Table) -> Self {
        let gamma =
            compute_gamma(self.tau_0, self.tau_1, self.type_score, self.pattern_score, table, dialect.delimiter);
        Self {
            dialect,
            gamma,
            tau_0: self.tau_0,
            tau_1: self.tau_1,
            type_score: self.type_score,
            pattern_score: self.pattern_score,
            num_rows: self.num_rows,
            num_fields: self.num_fields,
            is_uniform: self.is_uniform,
        }
    }

    /// Create a zero score (for failed parses).
    pub const fn zero(dialect: PotentialDialect) -> Self {
        Self {
            dialect,
            gamma: 0.0,
            tau_0: 0.0,
            tau_1: 0.0,
            type_score: 0.0,
            pattern_score: 0.0,
            num_rows: 0,
            num_fields: 0,
            is_uniform: false,
        }
    }
}

/// Compute the combined gamma score.
///
/// The gamma score combines multiple factors:
/// - tau_0 (consistency): higher is better
/// - tau_1 (dispersion): higher is better (less dispersion)
/// - type_score: higher means better type consistency
/// - pattern_score: higher means more specific patterns detected
/// - Additional bonuses for uniform tables and reasonable field counts
/// - Penalties for uncommon delimiters
fn compute_gamma(tau_0: f64, tau_1: f64, type_score: f64, pattern_score: f64, table: &Table, delimiter: u8) -> f64 {
    if table.is_empty() {
        return 0.0;
    }

    // Base score from uniformity metrics
    let uniformity_score = (tau_0 * tau_1).sqrt();

    // Type detection contributes to the score
    let type_contribution = type_score * 0.3;

    // Pattern specificity provides additional signal
    let pattern_contribution = pattern_score * 0.1;

    // Bonus for having multiple rows (more data is more reliable)
    let row_bonus = (table.num_rows().min(20) as f64 / 20.0) * 0.1;

    // Bonus for having multiple fields (single field might be wrong delimiter)
    let field_count = table.modal_field_count();
    let field_bonus = if field_count >= 2 { (field_count.min(10) as f64 / 10.0) * 0.2 } else { 0.0 };

    // Penalty for single-field tables (likely wrong delimiter)
    let single_field_penalty = if field_count == 1 { 0.5 } else { 1.0 };

    // Penalty for extremely high field counts (might be splitting on wrong char)
    let high_field_penalty = if field_count > 100 {
        0.5
    } else if field_count > 50 {
        0.8
    } else {
        1.0
    };

    // Penalty for very small samples (less reliable detection)
    let num_rows = table.num_rows();
    let small_sample_penalty = if num_rows < 3 {
        0.80 // Very small - high unreliability
    } else if num_rows < 5 {
        0.90 // Small - moderate unreliability
    } else {
        1.0
    };

    // Penalty for uncommon delimiters
    // This helps prevent rare characters from winning due to accidental patterns
    let delimiter_penalty = match delimiter {
        b',' | b';' | b'\t' => 1.0, // Common delimiters - no penalty
        b'|' => 0.98,               // Pipe - slight penalty
        b':' => 0.90,               // Colon - moderate penalty (often in timestamps)
        // Space - significant penalty (often appears in text). On a table with
        // only a handful of rows there is not enough repetition to distinguish a
        // real space delimiter from incidental spacing, so penalise harder.
        b' ' => {
            if num_rows < SPACE_MIN_CONFIDENT_ROWS {
                0.45
            } else {
                0.75
            }
        }
        b'^' | b'~' => 0.80, // Rare delimiters
        // Hash - often a comment marker, but can be a legitimate delimiter.
        // For large uniform tables with ≥3 fields, reduce the penalty: the
        // heavy evidence of consistent multi-field parsing overrides the prior.
        //
        // Threshold rationale:
        //   - field_count >= 3: 1- or 2-field tables are too ambiguous — a file with
        //     comments (`# header`) parsed as 1-field could accidentally reach any
        //     uniform score.  Three or more fields give strong structural evidence.
        //   - num_rows >= 50: small tables may accidentally produce consistent patterns
        //     even with `#` as a comment character.  50 rows provides enough statistical
        //     weight to trust the uniformity signal.
        b'#' => {
            if field_count >= 3 && num_rows >= 50 {
                0.85 // Relaxed: large multi-field table is unlikely to be a comment file
            } else {
                0.60 // Strict default: treat `#` as a comment marker unless proven otherwise
            }
        }
        b'&' => 0.60, // Ampersand - very rare
        0xA7 => 0.78, // Section sign (§) - rare but legitimate delimiter
        b'/' => 0.65, // Forward slash - rare, often in paths/dates
        _ => 0.70,    // Unknown - penalty
    };

    // Combine all factors
    // uniformity_score * 0.5 + type_contribution + pattern_contribution + row_bonus + field_bonus;
    let raw_score = uniformity_score.mul_add(0.5, type_contribution) + pattern_contribution + row_bonus + field_bonus;

    raw_score * single_field_penalty * high_field_penalty * delimiter_penalty * small_sample_penalty
}

/// Score a dialect against the data.
///
/// Returns the DialectScore which includes the gamma score and component scores.
#[allow(dead_code)]
pub fn score_dialect(data: &[u8], dialect: &PotentialDialect, max_rows: usize) -> DialectScore {
    let quote_counts = QuoteCounts::new(data);
    let mut buffers = TypeScoreBuffers::new();
    let (score, _table) = score_dialect_with_counts(data, dialect, max_rows, &quote_counts, &mut buffers);
    score
}

/// Score a dialect against the data with pre-computed quote counts.
///
/// This is the internal implementation that accepts pre-computed QuoteCounts
/// to avoid redundant byte counting when scoring multiple dialects.
/// Returns both the score and the parsed table for potential reuse.
fn score_dialect_with_counts(
    data: &[u8],
    dialect: &PotentialDialect,
    max_rows: usize,
    quote_counts: &QuoteCounts,
    buffers: &mut TypeScoreBuffers,
) -> (DialectScore, Table) {
    let table = parse_table(data, dialect, max_rows);

    if table.is_empty() {
        return (DialectScore::zero(dialect.clone()), table);
    }

    let type_score = calculate_type_score(&table, buffers);
    let mut score = DialectScore::new(dialect.clone(), &table, type_score);

    // Apply quote evidence scoring using pre-computed counts and raw data for boundary detection
    let quote_multiplier = quote_evidence_score_with_data(data, quote_counts, dialect);
    score.gamma *= quote_multiplier;

    (score, table)
}

/// Per-line field-count statistics for `sep` in `data`, parsed with a
/// double-quote-aware toggle (a doubled `""` is an escaped quote that keeps the
/// field open): returns `(modal_field_count, lines_at_modal, total_non_empty_lines)`.
/// A genuine column delimiter partitions every row the same way; an incidental
/// content character does not.
fn separator_field_count_stats(data: &[u8], sep: u8) -> (usize, usize, usize) {
    let mut counts: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    let mut total_lines = 0usize;
    let mut in_quote = false;
    let mut fields = 1usize;
    let mut line_has_content = false;
    let mut i = 0;

    while let Some(&b) = data.get(i) {
        if b == b'"' {
            if in_quote && data.get(i + 1) == Some(&b'"') {
                i += 2; // escaped quote
                line_has_content = true;
                continue;
            }
            in_quote = !in_quote;
            line_has_content = true;
        } else if b == b'\n' && !in_quote {
            if line_has_content {
                *counts.entry(fields).or_default() += 1;
                total_lines += 1;
            }
            fields = 1;
            line_has_content = false;
        } else if b != b'\r' {
            if b == sep && !in_quote {
                fields += 1;
            }
            line_has_content = true;
        }
        i += 1;
    }
    if line_has_content {
        *counts.entry(fields).or_default() += 1;
        total_lines += 1;
    }

    let (modal, modal_lines) = counts.into_iter().max_by_key(|&(_, c)| c).unwrap_or((1, 0));
    (modal, modal_lines, total_lines)
}

/// Whether `sep` exhibits consistent row structure: it yields the same field
/// count (≥ 2) on a strong majority (≥ 80%) of non-empty lines. Used to decide
/// whether a content-prone separator (`/`, space, `#`, ...) is plausibly a real
/// column delimiter — and therefore may be trusted to bound quoted fields.
fn separator_is_structural(data: &[u8], sep: u8) -> bool {
    let (modal, modal_lines, total_lines) = separator_field_count_stats(data, sep);
    total_lines > 0 && modal >= 2 && modal_lines * 5 >= total_lines * 4
}

/// The set of bytes (indexed 0..256) that may bound a double-quoted field in
/// `data`. A separator qualifies only when it is an actual generated delimiter
/// candidate (`super::potential_dialects::DELIMITERS` — so non-candidates like
/// `:` are excluded), appears directly adjacent to a quote in the sample (`s"`
/// or `"s`), and is trustworthy: a common delimiter (`,` `;` `\t` `|`)
/// unconditionally, or another candidate only when it shows consistent row
/// structure (`separator_is_structural`).
fn trusted_boundary_separators(data: &[u8]) -> [bool; 256] {
    use super::potential_dialects::DELIMITERS;
    const COMMON: [u8; 4] = *b",;\t|";

    let mut adjacent_to_quote = [false; 256];
    let mut mark = |b: u8| {
        if let Some(adjacent) = adjacent_to_quote.get_mut(usize::from(b)) {
            *adjacent = true;
        }
    };
    for window in data.windows(2) {
        if let [a, b] = *window {
            if b == b'"' {
                mark(a);
            }
            if a == b'"' {
                mark(b);
            }
        }
    }

    let mut active = [false; 256];
    for &c in DELIMITERS {
        let idx = usize::from(c);
        if adjacent_to_quote.get(idx) == Some(&true) {
            // Common delimiters are trusted outright; other candidates must
            // partition the rows consistently (adjacency above prunes the work).
            if let Some(slot) = active.get_mut(idx) {
                *slot = COMMON.contains(&c) || separator_is_structural(data, c);
            }
        }
    }
    active
}

/// The smallest modal field count among the trusted boundary separators in
/// `data` that *structurally* partition the rows, or `None` if there are none.
/// This is the field count of the cleanest plausible delimiter whose quoted
/// fields could be trapping another candidate's separators.
///
/// A separator only counts here when it yields a modal field count `>= 2` on a
/// strong majority (`>= 80%`) of non-empty lines — the same evidence
/// `separator_is_structural` requires. In particular a common delimiter trusted
/// only from a single incidental quote-adjacency (e.g. one `",` line, modal
/// field count 1) is *not* a real alternative delimiter and must not count as a
/// cleaner boundary, or it would spuriously re-enable the over-split demotion in
/// an otherwise ambiguous case.
fn min_trusted_boundary_modal(data: &[u8]) -> Option<usize> {
    let active = trusted_boundary_separators(data);
    super::potential_dialects::DELIMITERS
        .iter()
        .filter(|&&c| active.get(usize::from(c)) == Some(&true))
        .filter_map(|&c| {
            let (modal, modal_lines, total_lines) = separator_field_count_stats(data, c);
            (modal >= 2 && modal_lines * 5 >= total_lines * 4).then_some(modal)
        })
        .min()
}

/// Count occurrences of `delimiter` that fall inside vs. outside double-quoted
/// (`"..."`) regions, returning `(inside, outside)`.
///
/// Used to detect candidates whose field count is inflated by a delimiter that
/// only appears *inside* double-quoted fields. The canonical example is a row
/// like `Field1,Field2,"Field;3;3;3"`: scored with `;` the `csv` reader does not
/// treat the mid-field `"` as a quote, so the three inner `;` split the row into
/// 4 fields, beating comma's correct 3. There every `;` is inside the quoted span
/// (`inside = 3, outside = 0`), whereas the true comma delimiter sits entirely
/// outside it (`inside = 0`).
///
/// Operates on LF-normalized data. A `"` only opens or closes a quoted region at
/// a *field boundary*: the start/end of data, a line break, or a separator that
/// the file shows abutting a quote (`s"` or `"s`) **and** that is trustworthy as a
/// boundary here. A boundary subset alone can't work — it can neither admit every
/// supported delimiter nor reject every content character — so two conditions are
/// combined:
///
/// 1. *Adjacency*: the separator must actually appear next to a quote in the
///    sample (derived from the data, not assumed).
/// 2. *Trustworthiness*: only a byte that is an actual generated delimiter
///    candidate (`super::potential_dialects::DELIMITERS`) may bound a quoted
///    field — a byte that can never be selected as the delimiter (e.g. `:`, which
///    is excluded because it appears in timestamps) must never demote a real
///    candidate. Among candidates, a common delimiter (`,` `;` `\t` `|`) is always
///    trusted; a content-prone one (space `/` `#` `&` `^` `~` `§`) is trusted only
///    when it shows consistent row structure (`separator_is_structural`), i.e. it
///    parses to a uniform field count and is therefore plausibly the real column
///    delimiter. This recognizes genuinely quoted fields after a content-prone
///    delimiter (e.g. a `/`-delimited file with quoted values, or
///    `flat_file_database.csv` whose `#`-delimited rows wrap a quoted value) while
///    a stray `"` after a content byte that does not partition the rows never
///    opens a region.
///
/// A doubled `""` is an escaped quote and keeps the region open. Counting is
/// independent of the candidate's own quote char; combined with the caller's
/// `outside == 0` requirement, a real delimiter (which always has occurrences
/// between fields, outside any quoted span) is never implicated.
fn dquoted_delimiter_counts(data: &[u8], delimiter: u8) -> (usize, usize) {
    let active = trusted_boundary_separators(data);
    // Line breaks and the data edge are always valid field boundaries.
    let is_boundary = |b: u8| b == b'\n' || b == b'\r' || active.get(usize::from(b)) == Some(&true);

    let mut in_quote = false;
    let mut inside = 0usize;
    let mut outside = 0usize;
    let mut i = 0;

    while let Some(&b) = data.get(i) {
        if b == b'"' {
            if in_quote {
                if data.get(i + 1) == Some(&b'"') {
                    // Escaped quote inside a quoted field; stay inside.
                    i += 2;
                    continue;
                }
                // Close only at a field boundary; otherwise treat as literal content.
                if data.get(i + 1).is_none_or(|&n| is_boundary(n)) {
                    in_quote = false;
                }
            } else if i == 0 || data.get(i - 1).is_some_and(|&p| is_boundary(p)) {
                // Open only when the quote sits at a field start.
                in_quote = true;
            }
        } else if b == delimiter {
            if in_quote {
                inside += 1;
            } else {
                outside += 1;
            }
        }
        i += 1;
    }

    (inside, outside)
}

/// Parse pre-normalized data with `parse_dialect` and compute the table-wide
/// part of its score. The score is `None` when the parse is empty.
fn base_score(
    normalized_data: &[u8],
    parse_dialect: &PotentialDialect,
    max_rows: usize,
    buffers: &mut TypeScoreBuffers,
) -> (Option<DialectScore>, Table) {
    let table = parse_table_normalized(normalized_data, parse_dialect, max_rows);

    if table.is_empty() {
        return (None, table);
    }

    let type_score = calculate_type_score(&table, buffers);
    let score = DialectScore::new(parse_dialect.clone(), &table, type_score);
    (Some(score), table)
}

/// Score a dialect against pre-normalized data with pre-computed quote counts.
///
/// `base` and `table` come from `base_score` for a parse that is identical to
/// parsing with `dialect` (possibly shared with other dialects), and the data
/// must already be normalized to LF line endings.
fn score_dialect_with_normalized_data(
    normalized_data: &[u8],
    dialect: &PotentialDialect,
    base: Option<&DialectScore>,
    table: &Table,
    quote_counts: &QuoteCounts,
    boundary_counts: &QuoteBoundaryCounts,
) -> DialectScore {
    let Some(base) = base else {
        return DialectScore::zero(dialect.clone());
    };

    let mut score = base.for_dialect(dialect.clone(), table);

    // Apply quote evidence scoring using pre-computed counts and cached boundary counts
    let quote_multiplier = quote_evidence_score_with_cached_boundaries(quote_counts, boundary_counts, dialect);

    // Dampen the quote boost when the first row has just 1 field AND the non-modal rows
    // exhibit diverse field counts (≥3 distinct values). This prevents JSON-content-in-
    // unquoted-fields from triggering a false 2.2x boost: e.g. a tab-delimited file where
    // unquoted JSON fields contain `,key"` patterns that look like opening quote boundaries
    // for comma+doublequote. In such files the first row (tab-delimited header) has 0 commas
    // → 1 field, and JSON data rows have wildly varying comma counts (e.g., 1, 46, 32, 19).
    //
    // The distinguishing check: if the rows that deviate from the modal all share the same
    // count (like {1, 1, 1} for preamble title rows), the non-uniformity is just preamble.
    // If the non-modal rows have ≥3 distinct field counts, the whole table is chaotically
    // variable — a strong signal that boundaries come from field content, not real quoting.
    let effective_multiplier = if quote_multiplier > 1.5 && score.num_fields >= 5 && !score.is_uniform {
        let first_fields = table.field_counts.first().copied().unwrap_or(score.num_fields);
        if first_fields <= 1 {
            // Count distinct field counts among non-modal rows.
            let modal = score.num_fields;
            let mut distinct_counts: Vec<usize> = table.field_counts.iter().filter(|&&c| c != modal).copied().collect();
            distinct_counts.sort_unstable();
            distinct_counts.dedup();
            let distinct_non_modal = distinct_counts.len();
            if distinct_non_modal >= 3 {
                // ≥3 distinct non-modal field counts → genuinely chaotic table, not just
                // a small preamble. Scale boost down to 30% of excess so the correct
                // dialect can compete.
                1.0 + (quote_multiplier - 1.0) * 0.3
            } else {
                quote_multiplier
            }
        } else {
            quote_multiplier
        }
    } else {
        quote_multiplier
    };
    // Two-layer penalty for space delimiter when most rows have an empty first field.
    // When leading spaces pad row numbers (e.g. `     1 # 'addr' # 'city'`):
    //   (a) The spaces between the delimiter and adjacent quote characters look like
    //       opening/closing quote boundaries, falsely triggering the 2.2× quote boost.
    //       Hard-cap the boost to ≤ 1.05 to suppress these spurious boundary signals.
    //   (b) The many split-on-space fields inflate field_bonus and field_count metrics.
    //       Multiply the combined gamma by 0.55 to offset this inflation.
    // Legitimate space-delimited files start their rows with actual content, not spaces,
    // so their first field is never empty and this penalty never fires.
    let effective_multiplier = if dialect.delimiter == b' ' && !table.rows.is_empty() {
        let empty_first_count = table.rows.iter().filter(|row| row.first().is_none_or(|f| f.is_empty())).count();
        if empty_first_count * 2 > table.rows.len() {
            // Cap the quote-evidence boost and fold in a 0.55 base penalty.
            //
            // Threshold rationale:
            //   - empty_first_count * 2 > rows.len(): more than 50% of rows have
            //     an empty first field.  This is the distinguishing signal for
            //     leading-space-padded formats (e.g. `     1 # 'addr'`); legitimate
            //     space-delimited files start rows with real content.
            //   - min(1.05): cap the quote multiplier to nearly-neutral.  The spaces
            //     adjacent to quote characters create false opening/closing boundary
            //     counts; capping prevents this spurious evidence from dominating.
            //   - 0.55: empirically calibrated to suppress the space-delimiter score
            //     below the true delimiter without zeroing it out entirely.  Values
            //     below ~0.50 caused regressions on legitimate space-delimited files.
            effective_multiplier.min(1.05) * 0.55
        } else {
            effective_multiplier
        }
    } else {
        effective_multiplier
    };
    score.gamma *= effective_multiplier;

    // Penalize comma when ' # ' (space-hash-space) appears consistently in the first
    // parsed field.  This pattern is a strong signal that '#' is the true separator used
    // with padded fields (e.g. `     1 # 'addr' # 'city'`), and that comma is splitting
    // on an incidental comma *inside* a '#'-delimited field (e.g. `city, state`).
    // The space-on-both-sides requirement excludes hex colours (`#FF0000`), CSS IDs
    // (`#header`), and other embedded '#' that are not separator uses.
    if dialect.delimiter == b',' && score.num_fields == 2 && !table.rows.is_empty() {
        let hash_sep_count =
            table.rows.iter().filter(|row| row.first().is_some_and(|f| f.trim_start().contains(" # "))).count();
        if hash_sep_count * 10 > table.rows.len() * 9 {
            // More than 90% of rows have ' # ' in field-0: comma is very likely
            // splitting inside '#'-delimited rows.  Apply a strong penalty so that
            // '#' dialects can outscore comma even after singlequote boosts.
            //
            // Threshold rationale:
            //   - 90% (hash_sep_count * 10 > rows.len() * 9): requires near-unanimous
            //     presence across rows to avoid penalizing CSV files that happen to
            //     contain ` # ` in a small number of text fields (e.g., comments or
            //     markdown-style tables).  A file that is genuinely '#'-delimited will
            //     have the pattern in virtually every row.
            //   - 0.82: chosen to be strong enough to let the '#' dialect win after its
            //     own penalty (0.85 for large tables) and single-quote boost (1.10) are
            //     factored in, without being so severe that it causes regressions on
            //     legitimate comma-separated files with rare embedded ' # '.
            score.gamma *= 0.82;
        }
    }

    // Penalize a candidate delimiter whose occurrences live *inside* double-quoted
    // (`"..."`) regions.  The `csv` reader only honours `"` as a quote when it opens
    // a field, so a delimiter splitting inside a mid-field `"..."` (e.g. `;` in
    // `Field1,Field2,"Field;3;3;3"`) yields spurious extra fields — inflating
    // field_bonus and pattern specificity and stealing the win from the true
    // delimiter.  In that case every occurrence of the spurious delimiter is inside
    // the quoted span, while the true delimiter (comma) sits entirely outside it.
    //
    // Requiring *every* occurrence to be inside a quoted span (`outside == 0`) keeps
    // this strictly targeted: a real delimiter always has occurrences between fields
    // (outside quotes), so it is never implicated, even on files with stray `"`
    // (inch marks) or apostrophe-heavy content.  The count is independent of the
    // candidate's own quote char, so all quote-variants of the spurious delimiter
    // are demoted together and the correct dialect wins.
    // The `modal_field_count() >= 2` guard ensures we only demote a candidate whose
    // *own parse* actually split on those inside-quote delimiters (inflating its
    // field count).  A correctly-quoted single-column file like `"123,,456.789"`
    // parses to one field under `,`+`"` (the inner commas are protected), so it is
    // left untouched and still wins on the common-delimiter tiebreaker.
    let candidate_modal = table.modal_field_count();
    if dialect.delimiter != b'"' && candidate_modal >= 2 && normalized_data.contains(&b'"') {
        let (inside, outside) = dquoted_delimiter_counts(normalized_data, dialect.delimiter);
        // A candidate with every occurrence inside a quoted span (`outside == 0`)
        // is provably not the real column delimiter — a real delimiter always has
        // occurrences *between* fields.  When a structural boundary delimiter
        // exists (the genuine column separator whose quoted fields trap this
        // candidate), demote the trapped candidate, with one guard:
        //   - a CONTENT-PRONE candidate (rare; `/`, `#`, space, ...) is always
        //     demoted — it is an artifact of separators trapped inside the real
        //     delimiter's quoted fields (e.g. `/` inside the `#`-quoted value of
        //     flat_file_database.csv);
        //   - a COMMON candidate (`,` `;` `\t` `|`) is demoted only on a genuine
        //     *over-split*: the structural boundary yields strictly fewer fields.
        //     For a genuinely ambiguous case like `a/"x;y"` (both `;` and `/` give
        //     2 fields) this leaves the common `;` alone rather than handing the
        //     win to the rarer `/`.
        let candidate_is_common = matches!(dialect.delimiter, b',' | b';' | b'\t' | b'|');
        let trapped = inside > 0
            && outside == 0
            && min_trusted_boundary_modal(normalized_data)
                .is_some_and(|boundary_modal| !candidate_is_common || boundary_modal < candidate_modal);
        if trapped {
            // Heavy demotion: this delimiter's field structure is an artifact of
            // separators trapped inside a cleaner delimiter's quoted fields.
            score.gamma *= 0.5;
        }
    }

    score
}

/// Calculate a score multiplier based on quote character evidence in the data.
///
/// This function examines the actual presence of quote characters in the data
/// to boost dialects where the quote char is genuinely used and penalize
/// Quote::None when quotes are present.
///
/// The scoring is conservative to avoid false positives from apostrophes
/// in text content (e.g., "John's" contains a single quote but isn't quoted).
#[allow(dead_code)]
fn quote_evidence_score(data: &[u8], dialect: &PotentialDialect) -> f64 {
    let quote_counts = QuoteCounts::new(data);
    quote_evidence_score_with_counts(&quote_counts, dialect)
}

/// Calculate quote evidence score using pre-computed quote counts.
/// This avoids redundant byte counting when scoring multiple dialects.
fn quote_evidence_score_with_counts(quote_counts: &QuoteCounts, dialect: &PotentialDialect) -> f64 {
    use crate::dialect::metadata::Quote;

    if quote_counts.data_len == 0 {
        return 1.0;
    }

    // Calculate density (quotes per 1000 bytes) - higher density suggests quoting
    let double_density = (quote_counts.double * 1000) / quote_counts.data_len;
    let single_density = (quote_counts.single * 1000) / quote_counts.data_len;

    // Threshold: need at least ~0.5% quote density to consider it significant
    // This filters out incidental apostrophes in text
    let min_density_threshold = 5; // 0.5% = 5 per 1000

    match dialect.quote {
        Quote::Some(b'"') => {
            if double_density >= min_density_threshold {
                // Double quotes have significant density - boost
                1.06
            } else {
                // Neutral - rely on other scoring factors
                1.0
            }
        }
        Quote::Some(b'\'') => {
            // Single quotes are tricky because apostrophes are common in text
            // Only boost if single quotes dominate AND double quotes are absent
            if double_density == 0 && single_density >= min_density_threshold {
                // No double quotes at all - strong single-quote evidence
                1.10
            } else if single_density >= min_density_threshold * 2 && double_density < min_density_threshold {
                // Strong evidence of single-quote usage
                1.05
            } else if double_density >= min_density_threshold {
                // Double quotes present but testing single - stronger penalty
                0.92
            } else {
                1.0
            }
        }
        Quote::None => {
            // Only penalize Quote::None when there's strong quoting evidence
            if double_density >= min_density_threshold {
                0.90
            } else {
                1.0
            }
        }
        Quote::Some(_) => 1.0, // Other quote chars - neutral
    }
}

/// Check if quote characters appear at field boundaries (stronger evidence).
/// Returns the count of boundary pairs found.
#[allow(dead_code)]
fn quote_boundary_count(data: &[u8], quote_char: u8, delimiter: u8) -> usize {
    let mut boundary_pairs = 0;
    for window in data.windows(2) {
        let [w0, w1] = *window else { continue };
        // Quote after delimiter/newline (field start)
        if (w0 == delimiter || w0 == b'\n' || w0 == b'\r') && w1 == quote_char {
            boundary_pairs += 1;
        }
        // Quote before delimiter/newline (field end)
        if w0 == quote_char && (w1 == delimiter || w1 == b'\n' || w1 == b'\r') {
            boundary_pairs += 1;
        }
    }
    // Also check start of data
    if data.first() == Some(&quote_char) {
        boundary_pairs += 1;
    }
    boundary_pairs
}

/// Compute the score multiplier for single-quote evidence.
///
/// Shared by both `quote_evidence_score_with_cached_boundaries` and
/// `quote_evidence_score_with_data` so that the two code paths stay in sync.
/// Previously each function contained an identical copy of these branches;
/// a divergence (one gets a fix the other misses) is prevented by this helper.
///
/// # Parameters
/// - `boundary_count`: total single-quote boundary events (opening + closing)
///   as returned by `get_boundary_count` or `quote_boundary_count`.  When
///   `opening_count == 0` every event counted here is a *closing* boundary.
/// - `opening_count`: opening-only boundary events (delimiter/newline → quote).
/// - `single_density`: single-quote count per 1000 bytes.
/// - `double_density`: double-quote count per 1000 bytes.
/// - `min_density_threshold`: minimum density to treat as significant (5 / 1000).
fn compute_single_quote_multiplier(
    quote_counts: &QuoteCounts,
    boundary_count: usize,
    opening_count: usize,
    single_density: usize,
    double_density: usize,
    min_density_threshold: usize,
) -> f64 {
    if quote_counts.double == 0
        && opening_count >= 2
        && boundary_count >= 4
        && single_density >= min_density_threshold * 2
    {
        // No double quotes, opening+closing boundaries, high density
        // This is strong evidence of single-quote quoting
        2.2
    } else if quote_counts.double == 0
        && opening_count >= 1
        && boundary_count >= 2
        && single_density >= min_density_threshold
    {
        // No double quotes, opening boundary present, decent density
        1.20
    } else if double_density >= min_density_threshold {
        // Double quotes present - penalize single-quote detection
        0.90
    } else if quote_counts.backslash_single > 0 && quote_counts.backslash_double == 0 && boundary_count == 0 {
        // Backslash-escaped single quotes (e.g. `Ships\' engineers`) with no
        // double-quote evidence — single-quote is the dialect's escape target.
        // Boost must exceed 5% to escape the quote-preference tiebreaker zone.
        //
        // `backslash_double` is used only as a negative guard: double-quoted files
        // don't need this boost because their `\"` pairs already produce sufficient
        // boundary events via the normal path above.
        1.10
    } else if quote_counts.double == 0 && opening_count == 0 && boundary_count >= 20 && single_density >= 50 {
        // Only closing single-quote boundaries (field-end `'<delim>` or `'\n`) but
        // no opening boundaries (delimiter → quote).  `boundary_count` reflects
        // total events from `get_boundary_count`/`quote_boundary_count`; because
        // `opening_count == 0`, every counted event here is a closing boundary.
        //
        // This pattern occurs when single-quote quoting uses a space between the
        // delimiter and the quote character (e.g. `# 'addr' # 'city'`): the
        // adjacency scan misses the opening `# '` pair due to the intermediate
        // space.
        //
        // Threshold rationale:
        //   - boundary_count >= 20: prose apostrophes rarely accumulate 20+
        //     closing boundary events in a structured file; this requires at
        //     least ~10 quoted fields at minimum.  Irish names, possessives, or
        //     contractions at line ends would need an unusually dense poem to
        //     reach this count before the density gate fires.
        //   - single_density >= 50 (50 per 1000 bytes = 5%): a very high density
        //     that prose text with incidental apostrophes typically does not reach.
        //     Together, both conditions make false positives from apostrophe-heavy
        //     plain text extremely unlikely.
        1.10
    } else if boundary_count == 0 && single_density > 0 {
        // Single quotes in content but not at any boundaries (no opening,
        // no closing).  Likely just apostrophes in text content.
        0.95
    } else {
        1.0
    }
}

/// Calculate quote evidence score using pre-computed counts and cached boundary counts.
/// This is the optimized version that avoids redundant data scanning.
fn quote_evidence_score_with_cached_boundaries(
    quote_counts: &QuoteCounts,
    boundary_counts: &QuoteBoundaryCounts,
    dialect: &PotentialDialect,
) -> f64 {
    use crate::dialect::metadata::Quote;

    if quote_counts.data_len == 0 {
        return 1.0;
    }

    // Calculate density (quotes per 1000 bytes) - higher density suggests quoting
    let double_density = (quote_counts.double * 1000) / quote_counts.data_len;
    let single_density = (quote_counts.single * 1000) / quote_counts.data_len;

    // Threshold: need at least ~0.5% quote density to consider it significant
    // This filters out incidental apostrophes in text
    let min_density_threshold = 5; // 0.5% = 5 per 1000

    match dialect.quote {
        Quote::Some(b'"') => {
            let boundary_count = boundary_counts.get_boundary_count(b'"', dialect.delimiter);
            if quote_counts.single == 0 && boundary_count >= 2 && double_density >= min_density_threshold {
                // No single quotes AND double quotes at boundaries with real density
                // This handles small files with quoted fields containing delimiters
                2.2
            } else if boundary_count >= 2 && double_density >= min_density_threshold {
                // Double quotes at boundaries with good density
                1.15
            } else if double_density >= min_density_threshold {
                // Double quotes have significant density - moderate boost
                1.08
            } else {
                // Neutral - rely on other scoring factors
                1.0
            }
        }
        Quote::Some(b'\'') => {
            // Single quotes are tricky because apostrophes are common in text
            // MUST have opening boundary evidence - apostrophes in content tend to appear
            // only before delimiters (closing only), while genuine quoting has both
            // opening (delimiter→quote) and closing (quote→delimiter) boundaries
            let boundary_count = boundary_counts.get_boundary_count(b'\'', dialect.delimiter);
            let opening_count = boundary_counts.get_single_opening_boundary_count(dialect.delimiter);
            compute_single_quote_multiplier(
                quote_counts,
                boundary_count,
                opening_count,
                single_density,
                double_density,
                min_density_threshold,
            )
        }
        Quote::None => {
            // Only penalize Quote::None when there's strong quoting evidence
            if double_density >= min_density_threshold {
                0.90
            } else {
                1.0
            }
        }
        Quote::Some(_) => 1.0, // Other quote chars - neutral
    }
}

/// Count opening quote boundaries (delimiter/newline → quote) only.
/// Used to distinguish genuine quoting from apostrophes that appear only at field ends.
fn quote_opening_boundary_count(data: &[u8], quote_char: u8, delimiter: u8) -> usize {
    let mut count = 0;
    for window in data.windows(2) {
        let [w0, w1] = *window else { continue };
        if (w0 == delimiter || w0 == b'\n' || w0 == b'\r') && w1 == quote_char {
            count += 1;
        }
    }
    // Also count start of data as an opening boundary
    if data.first() == Some(&quote_char) {
        count += 1;
    }
    count
}

/// Calculate quote evidence score using pre-computed counts and raw data for boundary detection.
/// This provides more accurate quote detection for small files.
fn quote_evidence_score_with_data(data: &[u8], quote_counts: &QuoteCounts, dialect: &PotentialDialect) -> f64 {
    use crate::dialect::metadata::Quote;

    if quote_counts.data_len == 0 {
        return 1.0;
    }

    // Calculate density (quotes per 1000 bytes) - higher density suggests quoting
    let double_density = (quote_counts.double * 1000) / quote_counts.data_len;
    let single_density = (quote_counts.single * 1000) / quote_counts.data_len;

    // Threshold: need at least ~0.5% quote density to consider it significant
    // This filters out incidental apostrophes in text
    let min_density_threshold = 5; // 0.5% = 5 per 1000

    match dialect.quote {
        Quote::Some(b'"') => {
            let boundary_count = quote_boundary_count(data, b'"', dialect.delimiter);
            if quote_counts.single == 0 && boundary_count >= 2 && double_density >= min_density_threshold {
                // No single quotes AND double quotes at boundaries with real density
                // This handles small files with quoted fields containing delimiters
                2.2
            } else if boundary_count >= 2 && double_density >= min_density_threshold {
                // Double quotes at boundaries with good density
                1.15
            } else if double_density >= min_density_threshold {
                // Double quotes have significant density - moderate boost
                1.08
            } else {
                // Neutral - rely on other scoring factors
                1.0
            }
        }
        Quote::Some(b'\'') => {
            // Single quotes are tricky because apostrophes are common in text
            // MUST have opening boundary evidence - apostrophes in content tend to appear
            // only before delimiters (closing only), while genuine quoting has both
            // opening (delimiter→quote) and closing (quote→delimiter) boundaries
            let boundary_count = quote_boundary_count(data, b'\'', dialect.delimiter);
            let opening_count = quote_opening_boundary_count(data, b'\'', dialect.delimiter);
            compute_single_quote_multiplier(
                quote_counts,
                boundary_count,
                opening_count,
                single_density,
                double_density,
                min_density_threshold,
            )
        }
        Quote::None => {
            // Only penalize Quote::None when there's strong quoting evidence
            if double_density >= min_density_threshold {
                0.90
            } else {
                1.0
            }
        }
        Quote::Some(_) => 1.0, // Other quote chars - neutral
    }
}

/// Find the best scoring dialect from a list.
///
/// When dialects have similar scores, this function prefers:
/// 1. Common delimiters (comma, semicolon, tab) over rare ones (space, #, &)
/// 2. Dialects with Quote::Some(b'"') over Quote::None (standard default)
/// 3. Dialects with Quote::Some(b'"') over Quote::Some(b'\'')
pub fn find_best_dialect(scores: &[DialectScore]) -> Option<&DialectScore> {
    // First, check if all dialects result in single-field tables
    // In that case, prefer comma as the default delimiter
    let all_single_field = scores.iter().filter(|s| s.gamma > 0.0).all(|s| s.num_fields <= 1);

    scores.iter().filter(|s| s.gamma > 0.0).max_by(|a, b| {
        // If scores are very close (within 5%, score_ratio > 0.95), use delimiter and quote preference
        let score_ratio = if a.gamma > b.gamma { b.gamma / a.gamma } else { a.gamma / b.gamma };

        // For single-field tables, prefer comma delimiter and double-quote
        if all_single_field {
            let a_delim_priority = delimiter_priority(a.dialect.delimiter);
            let b_delim_priority = delimiter_priority(b.dialect.delimiter);

            match a_delim_priority.cmp(&b_delim_priority) {
                std::cmp::Ordering::Equal => {
                    // Same delimiter priority, use quote preference
                    let a_quote_priority = quote_priority(a.dialect.quote);
                    let b_quote_priority = quote_priority(b.dialect.quote);
                    return a_quote_priority.cmp(&b_quote_priority);
                }
                other => return other,
            }
        }

        if score_ratio > 0.95 {
            // Scores are close, use delimiter priority first, then quote priority
            let a_delim_priority = delimiter_priority(a.dialect.delimiter);
            let b_delim_priority = delimiter_priority(b.dialect.delimiter);

            match a_delim_priority.cmp(&b_delim_priority) {
                std::cmp::Ordering::Equal => {
                    // Delimiters have same priority, check quotes
                    let a_quote_priority = quote_priority(a.dialect.quote);
                    let b_quote_priority = quote_priority(b.dialect.quote);

                    match a_quote_priority.cmp(&b_quote_priority) {
                        std::cmp::Ordering::Equal => a.gamma.partial_cmp(&b.gamma).unwrap_or(std::cmp::Ordering::Equal),
                        other => other,
                    }
                }
                other => other,
            }
        } else {
            // Scores are different enough, use gamma directly
            a.gamma.partial_cmp(&b.gamma).unwrap_or(std::cmp::Ordering::Equal)
        }
    })
}

/// Returns a priority score for delimiters (higher = preferred).
/// Common delimiters like comma are preferred over rare ones like space or &.
const fn delimiter_priority(delimiter: u8) -> u8 {
    match delimiter {
        b',' => 10, // Comma - most common, highest priority
        b';' => 9,  // Semicolon - common in European locales
        b'\t' => 8, // Tab - TSV files
        // Pipe - common in data exports; intentionally tied with tab (both are
        // respectable standard delimiters); tie resolved by iteration order
        b'|' => 8,
        b':' => 4, // Colon - sometimes used, but also appears in timestamps
        b'^' => 3, // Caret - rare
        b'~' => 3, // Tilde - rare
        0xA7 => 2, // Section sign (§) - rare
        b'/' => 2, // Forward slash - rare
        b' ' => 2, // Space - very rare as delimiter, often appears in text
        b'#' => 1, // Hash - very rare, often used for comments
        b'&' => 1, // Ampersand - very rare
        _ => 0,    // Unknown delimiters - lowest priority
    }
}

/// Returns a priority score for quote characters (higher = preferred).
/// Double-quote is the standard default and should be preferred.
const fn quote_priority(quote: crate::dialect::metadata::Quote) -> u8 {
    use crate::dialect::metadata::Quote;
    match quote {
        Quote::Some(b'"') => 3,  // Standard default - highest priority
        Quote::Some(b'\'') => 2, // Single quote - second priority
        Quote::None => 1,        // No quoting - lowest priority
        Quote::Some(_) => 0,     // Other quote chars - very low priority
    }
}

/// Score all potential dialects and return sorted by gamma score (descending).
#[allow(dead_code)]
pub fn score_all_dialects(data: &[u8], dialects: &[PotentialDialect], max_rows: usize) -> Vec<DialectScore> {
    let (scores, _) = score_all_dialects_with_best_table(data, dialects, max_rows);
    scores
}

/// Score all potential dialects and return sorted by gamma score (descending),
/// along with the parsed table of the best-scoring dialect and the dialect it
/// was parsed with.
///
/// Returning the dialect lets callers verify that the cached table matches the
/// dialect they ultimately select (which may differ from the top-gamma one due
/// to tiebreakers) without relying on `scores` ordering.
///
/// This avoids re-parsing the best dialect's data for preamble detection
/// and metadata building.
pub fn score_all_dialects_with_best_table(
    data: &[u8],
    dialects: &[PotentialDialect],
    max_rows: usize,
) -> (Vec<DialectScore>, Option<(PotentialDialect, Table)>) {
    use crate::dialect::metadata::Quote;

    // Pre-compute quote counts once for all dialect evaluations
    let quote_counts = QuoteCounts::new(data);

    // Get the list of delimiters being tested
    let delimiters: Vec<u8> =
        dialects.iter().map(|d| d.delimiter).collect::<std::collections::HashSet<_>>().into_iter().collect();

    // Detect and normalize line endings once for all dialects
    // All dialects in the list have the same line terminator (set by detect_line_terminator)
    let line_terminator = dialects.first().map_or(super::potential_dialects::LineTerminator::LF, |d| d.line_terminator);
    let normalized_data = super::potential_dialects::normalize_line_endings(data, line_terminator);
    let normalized_bytes: &[u8] = normalized_data.as_ref();

    // Pre-compute quote boundary counts for all delimiters in one pass (on normalized data)
    let boundary_counts = QuoteBoundaryCounts::new(normalized_bytes, &delimiters);

    // Dialects that must parse to identical tables share one parse. A quote char
    // that never occurs quotes nothing, exactly like `Quote::None`; and every
    // delimiter that never occurs yields the same one-field-per-line table.
    // Every dialect is still scored, so selection sees the full candidate set.
    let mut present = [None::<bool>; 256];
    let mut is_present = |b: u8| {
        present.get_mut(usize::from(b)).is_some_and(|p| *p.get_or_insert_with(|| normalized_bytes.contains(&b)))
    };
    let mut parse_dialects: Vec<PotentialDialect> = Vec::new();
    let mut parse_keys: Vec<(Option<u8>, Quote)> = Vec::new();
    let parse_index: Vec<usize> = dialects
        .iter()
        .map(|d| {
            let delimiter = is_present(d.delimiter).then_some(d.delimiter);
            let quote = match d.quote {
                Quote::Some(q) if !is_present(q) => Quote::None,
                q => q,
            };
            let key = (delimiter, quote);
            parse_keys.iter().position(|k| *k == key).unwrap_or_else(|| {
                parse_keys.push(key);
                parse_dialects.push(PotentialDialect::new(d.delimiter, quote, d.line_terminator));
                parse_keys.len() - 1
            })
        })
        .collect();

    // Parse and compute table-wide scores, reusing one TypeScoreBuffers
    let mut buffers = TypeScoreBuffers::new();
    let mut parsed: Vec<(Option<DialectScore>, Table)> =
        parse_dialects.iter().map(|pd| base_score(normalized_bytes, pd, max_rows, &mut buffers)).collect();

    let mut scores: Vec<DialectScore> = dialects
        .iter()
        .zip(parse_index.iter())
        .filter_map(|(d, &p)| {
            let (base, table) = parsed.get(p)?;
            Some(score_dialect_with_normalized_data(
                normalized_bytes,
                d,
                base.as_ref(),
                table,
                &quote_counts,
                &boundary_counts,
            ))
        })
        .collect();

    // Keep first-maximum semantics: when two dialects tie on gamma, the one
    // with the lower index (earlier in `dialects`) wins — matching the
    // original sequential `if score.gamma > best_gamma` loop which used
    // strict `>` so the first winner was never displaced by a tie.
    let best_table = scores
        .iter()
        .enumerate()
        .max_by(|(i, a), (j, b)| {
            a.gamma.partial_cmp(&b.gamma).unwrap_or(std::cmp::Ordering::Equal).then_with(|| j.cmp(i))
            // lower index wins on tie
        })
        .map(|(i, s)| (i, s.dialect.clone()))
        .and_then(|(i, dialect)| {
            let p = *parse_index.get(i)?;
            (p < parsed.len()).then(|| (dialect, parsed.swap_remove(p).1))
        });

    // Sort by gamma score descending
    scores.sort_by(|a, b| b.gamma.partial_cmp(&a.gamma).unwrap_or(std::cmp::Ordering::Equal));

    (scores, best_table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dialect::metadata::Quote;
    use crate::dialect::tum::potential_dialects::LineTerminator;

    #[test]
    fn test_score_simple_csv() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n";
        let dialect = PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF);

        let score = score_dialect(data, &dialect, 100);
        assert!(score.gamma > 0.0);
        assert_eq!(score.num_fields, 3);
        assert!(score.is_uniform);
    }

    #[test]
    fn test_wrong_delimiter_lower_score() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n";

        let correct_dialect = PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF);
        let wrong_dialect = PotentialDialect::new(b';', Quote::Some(b'"'), LineTerminator::LF);

        let correct_score = score_dialect(data, &correct_dialect, 100);
        let wrong_score = score_dialect(data, &wrong_dialect, 100);

        assert!(correct_score.gamma > wrong_score.gamma);
    }

    #[test]
    fn test_find_best_dialect() {
        let data = b"a,b,c\n1,2,3\n4,5,6\n";
        let dialects = vec![
            PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b';', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b'\t', Quote::Some(b'"'), LineTerminator::LF),
        ];

        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b',');
    }

    #[test]
    fn test_dquoted_delimiter_counts() {
        // Every `;` lives inside the quoted field; both commas are outside it.
        let data = b"Field1,Field2,\"Field;3;3;3\"\n";
        assert_eq!(dquoted_delimiter_counts(data, b';'), (3, 0));
        assert_eq!(dquoted_delimiter_counts(data, b','), (0, 2));
    }

    #[test]
    fn test_dquoted_delimiter_counts_literal_quotes_not_trapped() {
        // Inch-mark-like literal `"` (not at field boundaries) must NOT open a
        // quoted region, so the real `;` delimiter between `5"` and `6"` stays
        // counted as outside — otherwise it would be wrongly demoted as a
        // delimiter trapped inside quotes.
        let data = b"5\";6\"\n7\";8\"\n";
        assert_eq!(dquoted_delimiter_counts(data, b';'), (0, 2));

        // A genuinely quoted field whose value contains the delimiter still counts
        // as inside (opening `"` follows the comma, closing `"` precedes the EOL).
        let quoted = b"a,\"x;y;z\"\n";
        assert_eq!(dquoted_delimiter_counts(quoted, b';'), (2, 0));
    }

    #[test]
    fn test_dquoted_counts_boundaries_are_data_driven() {
        // A COMMON delimiter (`,` `;` `\t` `|`) adjacent to a quote always opens a
        // genuine quoted region, so the inner `;` is counted as inside.
        assert_eq!(dquoted_delimiter_counts(b"a,\"x;b\"\n", b';'), (1, 0));

        // A content-prone CANDIDATE delimiter (`/`, space, `#`, ...) that
        // partitions every row the same way shows consistent structure, so it IS
        // trusted as a quoted-field boundary and the inner `;` counts as inside.
        assert_eq!(dquoted_delimiter_counts(b"a/\"x;b\"\nc/\"y;d\"\n", b';'), (2, 0));

        // `:` is NOT a generated delimiter candidate (excluded — it appears in
        // timestamps), so even with perfectly consistent structure it must never
        // bound a quoted field and must never demote a real candidate like `;`.
        assert_eq!(dquoted_delimiter_counts(b"a:\"x;b\"\nc:\"y;d\"\n", b';'), (0, 2));

        // A content-prone byte that does NOT consistently partition the rows
        // (here `/` appears on only one of four lines) is incidental content, not
        // a delimiter, so its `"` does not open a region: the `;` stays outside.
        assert_eq!(dquoted_delimiter_counts(b"a/\"x;b\"\np\nq\nr\n", b';'), (0, 1));

        // A `"` adjacent only to content (a digit inch mark, never a delimiter)
        // does not open a region: the `;` stays outside.
        assert_eq!(dquoted_delimiter_counts(b"5\";6\"\n7\";8\"\n", b';'), (0, 2));
    }

    #[test]
    fn test_colon_not_trusted_as_quote_boundary_end_to_end() {
        // `:` is excluded from the generated delimiter set, so a colon adjacent to
        // literal quotes must not let the inside-quote demotion fire on a real
        // candidate. Scored over generated dialects, `;` (a true candidate) must
        // win rather than being demoted by the non-candidate `:`.
        let data = b"a:\"x;y\"\nb:\"p;q\"\nc:\"r;s\"\nd:\"t;u\"\ne:\"v;w\"\n";
        let dialects = super::super::potential_dialects::generate_dialects_with_terminator(LineTerminator::LF);
        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b';');
    }

    #[test]
    fn test_separator_is_structural() {
        // `/` partitions every row into 2 fields → structural.
        assert!(separator_is_structural(b"a/\"x;b\"\nc/\"y;d\"\n", b'/'));
        // `/` appears on only one of four lines → not structural.
        assert!(!separator_is_structural(b"a/\"x;b\"\np\nq\nr\n", b'/'));
        // A separator that never appears → not structural (single field).
        assert!(!separator_is_structural(b"a\nb\nc\n", b'/'));
    }

    #[test]
    fn test_separator_modal_field_count() {
        let modal = |data: &[u8], sep: u8| separator_field_count_stats(data, sep).0;
        // `/` splits each row into 2 fields (it sits outside the quoted value).
        assert_eq!(modal(b"a/\"x;y\"\nc/\"p;q\"\n", b'/'), 2);
        // `;` is *inside* the quoted value, so the quote-aware count is 1 field —
        // it does not partition the rows once `"` quoting is respected.
        assert_eq!(modal(b"a/\"x;y\"\nc/\"p;q\"\n", b';'), 1);
        // With no quotes, `;` splits the blob into many fields.
        assert_eq!(modal(b"1#a;b;c;d\n2#e;f;g;h\n", b';'), 4);
    }

    #[test]
    fn test_equal_field_count_ambiguity_keeps_candidate() {
        // `a/"x;y"`: `/` and `;` both yield 2 fields, so neither over-splits the
        // other — the inside-quote demotion must NOT fire and the common delimiter
        // `;` is kept rather than handing the win to the rarer `/`.
        let data = b"a/\"x;y\"\nb/\"p;q\"\nc/\"r;s\"\nd/\"t;u\"\ne/\"v;w\"\n";
        let dialects = super::super::potential_dialects::generate_dialects_with_terminator(LineTerminator::LF);
        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b';');
    }

    #[test]
    fn test_over_split_candidate_is_demoted() {
        // Here `#` cleanly partitions each row into 2 fields while `;` over-splits
        // the quoted `#`-field into many — `;` over-splits relative to `#`, so the
        // demotion fires and `#` wins.
        let data = b"id#\"a;b;c;d;e\"\n1#\"f;g;h;i;j\"\n2#\"k;l;m;n;o\"\n3#\"p;q;r;s;t\"\n4#\"u;v;w;x;y\"\n";
        let dialects = super::super::potential_dialects::generate_dialects_with_terminator(LineTerminator::LF);
        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b'#');
    }

    #[test]
    fn test_content_prone_candidate_demoted_at_equal_field_count() {
        // `#` (the real delimiter) and `/` both yield 4 fields, but every `/` is
        // trapped inside the `#`-quoted value (`outside == 0`), so `/` cannot be the
        // real delimiter. A content-prone trapped candidate is demoted even at an
        // equal field count, so the structural `#` wins — this mirrors
        // flat_file_database.csv (a `#`-delimited file whose quoted blob contains
        // slashes) and must not regress.
        let data = b"a#b#c#\"w/x/y/z\"\nd#e#f#\"m/n/o/p\"\ng#h#i#\"q/r/s/t\"\nj#k#l#\"u/v/w/x\"\nm#n#o#\"y/z/a/b\"\n";
        let dialects = super::super::potential_dialects::generate_dialects_with_terminator(LineTerminator::LF);
        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b'#');
    }

    #[test]
    fn test_incidental_common_delimiter_not_counted_as_boundary() {
        // `/` structurally partitions 5 of 6 rows into 2 fields; the lone
        // `foo,"bar"` line makes comma quote-adjacent but comma's modal field
        // count is 1 (it does not partition the rows), so only `/` (modal 2) is a
        // real alternative boundary — comma must not register as a cleaner one.
        let data = b"a/\"x;y\"\nb/\"p;q\"\nc/\"r;s\"\nd/\"t;u\"\ne/\"v;w\"\nfoo,\"bar\"\n";
        assert_eq!(min_trusted_boundary_modal(data), Some(2));
    }

    #[test]
    fn test_sparse_incidental_comma_does_not_demote_ambiguous_candidate() {
        // Same data: `;` and `/` are equally plausible (both 2 fields), and the
        // incidental comma must not re-enable the over-split demotion — so `;` (the
        // common delimiter) is kept rather than handed to the rarer `/`.
        let data = b"a/\"x;y\"\nb/\"p;q\"\nc/\"r;s\"\nd/\"t;u\"\ne/\"v;w\"\nf/\"g;h\"\nm,\"n\"\n";
        let dialects = super::super::potential_dialects::generate_dialects_with_terminator(LineTerminator::LF);
        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b';');
    }

    #[test]
    fn test_literal_quotes_do_not_demote_true_delimiter() {
        // `;`-delimited rows whose values end in inch marks (`5"`) must keep `;`
        // the winner: the literal `"` are not field-boundary quotes, so the
        // inside-quote penalty must not fire on the true delimiter.
        let data = b"name;height\nboard;5\"\nplank;6\"\nbeam;7\"\njoist;8\"\nstud;9\"\nrail;10\"\n";
        let dialects = vec![
            PotentialDialect::new(b';', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b';', Quote::None, LineTerminator::LF),
            PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b',', Quote::None, LineTerminator::LF),
        ];

        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b';');
    }

    #[test]
    fn test_quoted_delimiter_does_not_steal_win() {
        // `Field1,Field2,"Field;3;3;3"`: the `;` only appear inside the quoted
        // field, so the `csv` reader (which ignores the mid-field quote) splits
        // the row into 4 fields under `;` and would otherwise beat comma's 3.
        // The inside-quote penalty must keep comma the winner.
        let data = b"Field1,Field2,\"Field;3;3;3\"\n";
        let dialects = vec![
            PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b';', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b';', Quote::None, LineTerminator::LF),
        ];

        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b',');
    }

    #[test]
    fn test_single_column_quoted_commas_not_penalized() {
        // A correctly-quoted single-column value whose only commas are inside the
        // quotes (e.g. `"123,,456.789"`) parses to one field under `,`+`"`, so the
        // inside-quote penalty must NOT fire — comma stays the winner over `;`.
        let data = b"decimal\n\"123,,456.789\"\n\"1,000\"\n";
        let dialects = vec![
            PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF),
            PotentialDialect::new(b';', Quote::Some(b'"'), LineTerminator::LF),
        ];

        let scores = score_all_dialects(data, &dialects, 100);
        let best = find_best_dialect(&scores).unwrap();

        assert_eq!(best.dialect.delimiter, b',');
    }

    // --- Tests for quote_opening_boundary_count and get_single_opening_boundary_count ---

    #[test]
    fn test_quote_opening_boundary_count_apostrophes_only() {
        // Apostrophes appear only before delimiters (closing-only), not at field starts
        // e.g. "value's, other" - apostrophe is mid-word, not at field start
        let data = b"value's, other's, thing's\n";
        let count = quote_opening_boundary_count(data, b'\'', b',');
        // No delimiter→quote or newline→quote or leading-quote transitions
        assert_eq!(count, 0);
    }

    #[test]
    fn test_quote_opening_boundary_count_genuine_quoting() {
        // Genuine single-quote quoting: quote appears at field start after delimiter/newline
        let data = b",'field', 'next'\n";
        let count = quote_opening_boundary_count(data, b'\'', b',');
        // First window [b',', b'\''] is delimiter→quote → +1 opening boundary
        // Second window [b' ', b'\''] is space→quote (space not a delimiter here) → 0
        assert!(count >= 1, "expected at least 1 opening boundary, got {count}");
    }

    #[test]
    fn test_quote_opening_boundary_count_leading_quote() {
        // Data starts with the quote character = opening boundary
        let data = b"'field','next'\n";
        let count = quote_opening_boundary_count(data, b'\'', b',');
        // Starts with quote (+1), and delimiter→quote at position 7→8 (+1)
        assert_eq!(count, 2);
    }

    #[test]
    fn test_quote_opening_boundary_count_empty() {
        let count = quote_opening_boundary_count(b"", b'\'', b',');
        assert_eq!(count, 0);
    }

    #[test]
    fn test_get_single_opening_boundary_count_apostrophes_only() {
        // Apostrophes only at field ends (before delimiter) — no opening boundaries
        // "it's, we're, they've" — each apostrophe is mid-word, not at a field start
        let data = b"it's, we're, they've\n";
        let delimiters = vec![b','];
        let counts = QuoteBoundaryCounts::new(data, &delimiters);
        let opening = counts.get_single_opening_boundary_count(b',');
        assert_eq!(opening, 0, "apostrophes should produce zero opening boundaries");
    }

    #[test]
    fn test_get_single_opening_boundary_count_genuine_quoting() {
        // Genuine single-quote quoting: 'val','val2' — quote appears right after delimiter
        let data = b"'first','second','third'\n";
        let delimiters = vec![b','];
        let counts = QuoteBoundaryCounts::new(data, &delimiters);
        let opening = counts.get_single_opening_boundary_count(b',');
        // data[0] == b'\'' counts via starts_with_single in get_boundary_count, but
        // get_single_opening_boundary_count only counts delimiter→quote and newline→quote,
        // plus data[0] if it is a quote (handled by starts_with_single bonus)
        assert!(opening >= 2, "expected ≥2 opening boundaries for genuinely quoted fields, got {opening}");
    }

    // --- Tests for the five new heuristics ---

    // Heuristic 1: `#` delimiter penalty relaxation for large multi-field tables.

    #[test]
    fn test_hash_penalty_strict_for_small_table() {
        // Small table (10 rows, < 50 row threshold): hash penalty stays at 0.60.
        // Large table (60 rows, >= 50 row threshold): hash penalty relaxes to 0.85.
        //
        // We use score_all_dialects (the production path) so that the full heuristic
        // stack in score_dialect_with_normalized_data applies consistently.  The hash
        // penalty relaxation (0.60 → 0.85) lives in compute_gamma, which is reached via
        // both score_dialect and score_all_dialects; using score_all_dialects keeps this
        // test consistent with test_comma_hash_penalty_fires_on_hash_delimited_data.
        //
        // Note: a higher row count also earns a larger row_bonus (up to +0.10 at ≥20 rows,
        // computed as `(num_rows.min(20) / 20) * 0.1`).  At 10 rows the small table earns
        // +0.05; at 60 rows the large table earns the maximum +0.10 additive bonus.
        // row_bonus is additive, not multiplicative, so it shifts absolute scores rather
        // than scaling the ratio.  The 1.3× threshold remains defensible even if the
        // penalty ratio were to drop from 0.85/0.60 ≈ 1.42 down to ~1.30, because the
        // +0.05 additive gap in row_bonus further favours the large dataset on top of the
        // penalty ratio — both effects reinforce the same direction.
        let mut small_data = String::new();
        for _ in 0..10 {
            small_data.push_str("a#b#c\n");
        }
        let mut large_data = String::new();
        for _ in 0..60 {
            large_data.push_str("a#b#c\n");
        }

        let dialects = vec![PotentialDialect::new(b'#', Quote::Some(b'"'), LineTerminator::LF)];

        let small_scores = score_all_dialects(small_data.as_bytes(), &dialects, 200);
        let large_scores = score_all_dialects(large_data.as_bytes(), &dialects, 200);

        let small_score = small_scores.iter().find(|s| s.dialect.delimiter == b'#').unwrap();
        let large_score = large_scores.iter().find(|s| s.dialect.delimiter == b'#').unwrap();

        // The large table gets the relaxed 0.85 penalty vs the strict 0.60 for the small
        // table.  With identical per-row uniformity, the large score must exceed the small
        // score by at least the ratio 0.85/0.60 ≈ 1.42.  We use a conservative bound of
        // 1.3 to tolerate minor variation in type scoring across different row counts.
        assert!(
            large_score.gamma > small_score.gamma * 1.3,
            "large hash table (0.85 penalty) should outscore small hash table (0.60 penalty) \
             by factor ≥ 1.3; small={} large={}",
            small_score.gamma,
            large_score.gamma
        );
    }

    #[test]
    fn test_hash_penalty_relaxed_for_large_table() {
        // Large table (≥ 50 rows, ≥ 3 fields): hash penalty should relax to 0.85.
        let mut data = String::new();
        for i in 0..60 {
            data.push_str(&format!("val{i}#val{i}b#val{i}c\n"));
        }
        let bytes = data.as_bytes();

        let hash_dialect = PotentialDialect::new(b'#', Quote::Some(b'"'), LineTerminator::LF);

        let hash_score = score_dialect(bytes, &hash_dialect, 200);
        // Score must be non-trivial: a 60-row, 3-field uniform table with relaxed
        // penalty (0.85) should produce a meaningful gamma.
        assert!(
            hash_score.gamma > 0.3,
            "large hash-delimited table should have a meaningful gamma; got {}",
            hash_score.gamma
        );
    }

    // Heuristic 2: Space-delimiter dampening when >50% of rows have an empty first field.

    #[test]
    fn test_space_dampening_fires_when_majority_empty_first() {
        // Simulate a leading-space-padded format: every row starts with a single space,
        // so splitting on space yields an empty first field followed by two value fields
        // (3 fields total).  The dampening heuristic applies 0.55× when >50% of rows
        // have an empty first field.
        //
        // The undampened dataset uses the same delimiter and the same field count (3)
        // but without a leading space, so no empty first field is present and dampening
        // must NOT fire.  Equal field counts eliminate field-count as a confound so the
        // assertion purely isolates the 0.55× multiplier.
        //
        // Space dampening lives in score_dialect_with_normalized_data; we therefore use
        // score_all_dialects (the production path) rather than score_dialect so that the
        // heuristic is actually exercised.
        //
        // leading:  " a b\n c d\n e f\n" → ["", "a", "b"] per row  (3 fields, empty first)
        // baseline: "a b c\nd e f\ng h i\n" → ["a", "b", "c"] per row (3 fields, no empty)
        let leading_space_data = b" a b\n c d\n e f\n";
        let no_leading_space_data = b"a b c\nd e f\ng h i\n";

        let dialects = vec![PotentialDialect::new(b' ', Quote::Some(b'"'), LineTerminator::LF)];

        let dampened_scores = score_all_dialects(leading_space_data, &dialects, 100);
        let undampened_scores = score_all_dialects(no_leading_space_data, &dialects, 100);

        let dampened_score = dampened_scores.iter().find(|s| s.dialect.delimiter == b' ').unwrap();
        let undampened_score = undampened_scores.iter().find(|s| s.dialect.delimiter == b' ').unwrap();

        // Dampening (0.55×) must reduce the score compared to the undampened baseline.
        // Both datasets have identical three-field-per-row uniformity.  Note: the empty
        // first field in the leading-space dataset is classified as a distinct type from
        // the alphabetic values in the baseline, so column-0 type-consistency scores will
        // differ slightly between the two datasets independently of the 0.55× multiplier.
        // In practice the dampening effect (0.55×) is large enough to dominate this
        // residual type-scoring difference.
        assert!(
            dampened_score.gamma < undampened_score.gamma,
            "dampening should reduce score when majority rows have empty first field; \
             dampened={} undampened={}",
            dampened_score.gamma,
            undampened_score.gamma
        );
    }

    #[test]
    fn test_space_dampening_does_not_fire_when_minority_empty_first() {
        // Fewer than 50% of rows have empty first field — dampening must NOT fire.
        // One row starts with a space (empty first), two rows do not.
        let data = b" x y\na b\nc d\n";
        let space_dialect = PotentialDialect::new(b' ', Quote::Some(b'"'), LineTerminator::LF);

        let score = score_dialect(data, &space_dialect, 100);
        // Dampening should not have been applied; score should be reasonable.
        // Since dampening applies 0.55×, an un-dampened score near 0.5 would
        // become ~0.28 when dampened.  Without dampening it stays >= 0.4.
        // We just verify the score is non-zero and not catastrophically suppressed.
        assert!(score.gamma > 0.1, "dampening should not fire for minority empty-first; gamma={}", score.gamma);
    }

    // Heuristic 3: Comma penalty when ' # ' appears in >90% of first parsed fields.

    #[test]
    fn test_comma_hash_penalty_fires_on_hash_delimited_data() {
        // A '#'-delimited file where comma splits on an incidental comma inside a field.
        // Comma sees 2 fields: field-0 = "foo # baz", which contains ' # '.
        // When >90% of rows have ' # ' in field-0 AND num_fields == 2, the 0.82× penalty fires.
        //
        // The penalty lives in score_dialect_with_normalized_data (the path exercised by
        // score_all_dialects), NOT in the score_dialect path.  We therefore use
        // score_all_dialects for both datasets so the penalty is consistently applied
        // (or not) on both paths.
        let penalized_data = b"foo # baz,bar\nfoo # baz,bar\nfoo # baz,bar\n\
                               foo # baz,bar\nfoo # baz,bar\nfoo # baz,bar\n\
                               foo # baz,bar\nfoo # baz,bar\nfoo # baz,bar\n\
                               foo # baz,bar\n";

        // Structurally identical (2 fields per row, 10 rows, all-text) but field-0
        // has no ' # ' — the penalty must NOT fire here.
        let clean_data = b"foo bar baz,bar\nfoo bar baz,bar\nfoo bar baz,bar\n\
                           foo bar baz,bar\nfoo bar baz,bar\nfoo bar baz,bar\n\
                           foo bar baz,bar\nfoo bar baz,bar\nfoo bar baz,bar\n\
                           foo bar baz,bar\n";

        let dialects = vec![PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF)];

        let penalized_scores = score_all_dialects(penalized_data, &dialects, 100);
        let clean_scores = score_all_dialects(clean_data, &dialects, 100);

        let penalized_score = penalized_scores.iter().find(|s| s.dialect.delimiter == b',').unwrap();
        let clean_score = clean_scores.iter().find(|s| s.dialect.delimiter == b',').unwrap();

        assert!(penalized_score.gamma >= 0.0, "comma gamma must be non-negative");
        // The 0.82× penalty must reduce the comma score compared to the clean dataset.
        // Both datasets have identical two-field-per-row uniformity; the only scoring
        // difference is the ' # ' penalty on the penalized dataset.
        assert!(
            penalized_score.gamma < clean_score.gamma,
            "comma penalty (0.82×) should reduce score when ' # ' dominates field-0; \
             penalized={} clean={}",
            penalized_score.gamma,
            clean_score.gamma
        );
    }

    #[test]
    fn test_comma_hash_penalty_does_not_fire_below_90pct() {
        // Only 5 of 10 rows have ' # ' in field-0 → below 90% → no penalty.
        let data = b"a # b,c\na # b,c\na # b,c\na # b,c\na # b,c\n\
                     x,y\nx,y\nx,y\nx,y\nx,y\n";

        let comma_dialect = PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF);

        // Just verify scoring does not panic and produces a valid gamma.
        let score = score_dialect(data, &comma_dialect, 100);
        assert!(score.gamma >= 0.0);
    }

    // Heuristic 4: Backslash-escape boost for single-quote dialect.

    #[test]
    fn test_backslash_single_boost_applied() {
        // File with backslash-escaped single quotes and no double quotes.
        // boundary_count == 0 because the quote chars are not at field boundaries
        // (they appear inside words, not adjacent to the comma delimiter).
        // This triggers the 1.10× backslash-escape boost branch.
        let data_with_backslash = b"it\\'s fine,next\ndon\\'t stop,go\nwe\\'re here,now\n";

        // Structurally identical dataset with no apostrophes — no boost fires, multiplier = 1.0.
        let data_no_apostrophe = b"its fine,next\ndont stop,go\nwere here,now\n";

        let sq_dialect = PotentialDialect::new(b',', Quote::Some(b'\''), LineTerminator::LF);

        let boosted_score = score_dialect(data_with_backslash, &sq_dialect, 100);
        let baseline_score = score_dialect(data_no_apostrophe, &sq_dialect, 100);

        assert!(boosted_score.gamma > 0.0, "single-quote dialect must score positively; gamma={}", boosted_score.gamma);
        // The 1.10× backslash-escape boost must make the score net-positive relative
        // to the no-apostrophe baseline (which gets only the neutral 1.0 multiplier).
        // Both datasets have identical two-field-per-row uniformity and similar type
        // scores; the only scoring difference is the quote-evidence multiplier.
        assert!(
            boosted_score.gamma > baseline_score.gamma,
            "backslash-escape boost (1.10×) should raise sq score above no-apostrophe baseline; \
             boosted={} baseline={}",
            boosted_score.gamma,
            baseline_score.gamma
        );
    }

    #[test]
    fn test_backslash_boost_does_not_fire_when_double_quotes_present() {
        // backslash_single > 0 but backslash_double > 0 as well → no boost.
        let data = b"it\\'s,\"quoted\"\ndon\\'t,\"also\"\n";

        let sq_dialect = PotentialDialect::new(b',', Quote::Some(b'\''), LineTerminator::LF);

        // Verify scoring runs without panic; the 1.10× branch should NOT fire.
        let score = score_dialect(data, &sq_dialect, 100);
        assert!(score.gamma >= 0.0);
    }

    // Heuristic 5: Closing-only boundary boost — threshold edge tests.

    #[test]
    fn test_closing_only_boost_below_threshold_no_boost() {
        // boundary_count == 19 (just below threshold of 20) → boost should NOT fire.
        // boundary_count == 20 (at threshold) → 1.10× boost SHOULD fire.
        //
        // Both datasets have the same total row count (25 rows) to eliminate row-count
        // as a confound.  The only structural difference is 19 vs 20 closing boundaries.
        //
        // Pattern: `x'\trest\n` — quote before tab = closing boundary; quote is not
        // adjacent to a newline or at the start of data, so no opening boundaries.
        // `x\trest\n` — no quote, no boundary contribution.
        let tab_sq_dialect = PotentialDialect::new(b'\t', Quote::Some(b'\''), LineTerminator::LF);

        // 19-boundary dataset: 19 rows with a closing boundary + 6 padding rows = 25 total
        let mut data_19 = Vec::new();
        for _ in 0..19 {
            data_19.extend_from_slice(b"x'\trest\n");
        }
        for _ in 0..6 {
            data_19.extend_from_slice(b"x\trest\n");
        }

        // 20-boundary dataset: 20 rows with a closing boundary + 5 padding rows = 25 total
        let mut data_20 = Vec::new();
        for _ in 0..20 {
            data_20.extend_from_slice(b"x'\trest\n");
        }
        for _ in 0..5 {
            data_20.extend_from_slice(b"x\trest\n");
        }

        let score_19 = score_dialect(&data_19, &tab_sq_dialect, 200);
        let score_20 = score_dialect(&data_20, &tab_sq_dialect, 200);

        // At exactly 20 boundaries the closing-only 1.10× boost fires; at 19 it does
        // not (falls through to the neutral 1.0 branch).  Both datasets have identical
        // row counts and per-row structure, so the boost is the only score difference.
        assert!(
            score_20.gamma > score_19.gamma,
            "closing-only boost (1.10×) should fire at boundary_count=20 but not at 19; \
             score_19={} score_20={}",
            score_19.gamma,
            score_20.gamma
        );

        // Parallel assertion via score_all_dialects (cached path): the cached path
        // tallies boundary_count from QuoteBoundaryCounts struct fields, while the
        // non-cached path above iterates raw data directly.  Both paths share
        // compute_single_quote_multiplier, but a discrepancy in boundary tallying
        // between them would not be caught by score_dialect alone.
        // tab_sq_dialect is still in scope: score_dialect takes &PotentialDialect, not by value.
        let dialects = vec![tab_sq_dialect];
        let cached_19 = score_all_dialects(&data_19, &dialects, 200);
        let cached_20 = score_all_dialects(&data_20, &dialects, 200);
        let cached_score_19 = cached_19.iter().find(|s| s.dialect.delimiter == b'\t').unwrap();
        let cached_score_20 = cached_20.iter().find(|s| s.dialect.delimiter == b'\t').unwrap();
        assert!(
            cached_score_20.gamma > cached_score_19.gamma,
            "closing-only boost (1.10×) should fire on cached path at boundary_count=20 but not at 19; \
             cached_19={} cached_20={}",
            cached_score_19.gamma,
            cached_score_20.gamma
        );

        // Cross-path agreement: cached and non-cached paths must produce the same gamma
        // values, confirming that boundary tallying is consistent between them.  A bug
        // in QuoteBoundaryCounts field accumulation would cause a discrepancy here even
        // if both paths produce internally consistent orderings.
        // The two paths share compute_single_quote_multiplier and identical arithmetic,
        // so results should be bit-identical (difference = 0.0).  1e-9 is a generous
        // sentinel that would catch any real boundary-tallying divergence.
        let tolerance = 1e-9_f64;
        assert!(
            (cached_score_19.gamma - score_19.gamma).abs() < tolerance,
            "cached and non-cached paths disagree on 19-boundary score: \
             non_cached={} cached={}",
            score_19.gamma,
            cached_score_19.gamma
        );
        assert!(
            (cached_score_20.gamma - score_20.gamma).abs() < tolerance,
            "cached and non-cached paths disagree on 20-boundary score: \
             non_cached={} cached={}",
            score_20.gamma,
            cached_score_20.gamma
        );
    }

    /// Build a table carrying only `field_counts`, which is all
    /// `all_modal_window` inspects.
    fn table_with_field_counts(counts: &[usize]) -> Table {
        let mut table = Table::new();
        table.field_counts = counts.to_vec();
        table.update_modal_field_count();
        table
    }

    #[test]
    fn test_all_modal_window_dd_wickenburg_shape() {
        // The real `;` parse of dd_Wickenburg_nobmp_623.csv under the default
        // Records(100) sample: 12 non-tabular preamble rows, 56 uniform data
        // rows, and one trailing record truncated mid-sample.
        let mut counts = vec![1; 12];
        counts.extend(std::iter::repeat_n(684, 56));
        counts.push(63);
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), Some((12, 68)));
    }

    #[test]
    fn test_all_modal_window_without_truncated_tail() {
        let mut counts = vec![1; 3];
        counts.extend(std::iter::repeat_n(20, 12));
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), Some((3, 15)));
    }

    #[test]
    fn test_all_modal_window_rejects_single_deviating_row() {
        // One odd leading row is ordinary title/header variance, not a preamble.
        let mut counts = vec![1];
        counts.extend(std::iter::repeat_n(20, 12));
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), None);
    }

    #[test]
    fn test_all_modal_window_rejects_thick_preamble_rows() {
        // Discarded rows holding >= 25% of the modal field count are ragged
        // data, not a non-tabular preamble.
        let mut counts = vec![10, 10];
        counts.extend(std::iter::repeat_n(20, 12));
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), None);
    }

    #[test]
    fn test_all_modal_window_rejects_single_column_table() {
        let counts = vec![1; 20];
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), None);
    }

    #[test]
    fn test_all_modal_window_rejects_oversized_trim_fraction() {
        // 30 preamble rows out of 60 exceeds the 25% trim cap.
        let mut counts = vec![1; 30];
        counts.extend(std::iter::repeat_n(20, 30));
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), None);
    }

    #[test]
    fn test_all_modal_window_rejects_short_table() {
        let mut counts = vec![1; 2];
        counts.extend(std::iter::repeat_n(20, 5));
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), None);
    }

    #[test]
    fn test_all_modal_window_rejects_interior_blip() {
        // A non-modal row in the middle must not let the candidate discard the
        // modal rows before it: those rows fail the field-ratio guard.
        let mut counts = vec![20; 8];
        counts.push(1);
        counts.extend(std::iter::repeat_n(20, 8));
        let table = table_with_field_counts(&counts);
        assert_eq!(all_modal_window(&table), None);
    }

    #[test]
    fn test_space_needs_enough_rows_to_be_confident() {
        // Three rows of comma-separated values that also contain spaces: space
        // must not win on so little evidence.
        let few = "a, b, c, d\n1, 2, 3, 4\n5, 6, 7, 8\n";
        let space = PotentialDialect::new(b' ', Quote::Some(b'"'), LineTerminator::LF);
        let comma = PotentialDialect::new(b',', Quote::Some(b'"'), LineTerminator::LF);
        assert!(score_dialect(few.as_bytes(), &space, 0).gamma < score_dialect(few.as_bytes(), &comma, 0).gamma);

        // A genuinely space-delimited table with enough rows still wins.
        let mut many = String::from("id name score\n");
        for i in 0..20 {
            many.push_str(&format!("{i} name{i} {i}\n"));
        }
        let space_many = score_dialect(many.as_bytes(), &space, 0);
        let comma_many = score_dialect(many.as_bytes(), &comma, 0);
        assert!(
            space_many.gamma > comma_many.gamma,
            "space ({}) should beat comma ({}) on a real space-delimited table",
            space_many.gamma,
            comma_many.gamma
        );
    }

    #[test]
    fn test_preamble_window_lets_true_delimiter_win() {
        // A 12-row non-tabular preamble above a uniform `;` table: `;` must beat
        // the degenerate single-field `\t` parse.
        let mut data = String::new();
        for i in 0..12 {
            data.push_str(&format!("$$meta_{i}=[1,2,3]\n"));
        }
        data.push_str("h1;h2;h3;h4;h5\n");
        for i in 0..20 {
            data.push_str(&format!("{i};{i};{i};{i};{i}\n"));
        }

        let semi = PotentialDialect::new(b';', Quote::Some(b'"'), LineTerminator::LF);
        let tab = PotentialDialect::new(b'\t', Quote::Some(b'"'), LineTerminator::LF);
        let semi_score = score_dialect(data.as_bytes(), &semi, 0);
        let tab_score = score_dialect(data.as_bytes(), &tab, 0);

        assert!(
            semi_score.gamma > tab_score.gamma,
            "semicolon ({}) should outscore the degenerate tab parse ({})",
            semi_score.gamma,
            tab_score.gamma
        );
    }

    #[test]
    fn test_shared_parses_score_like_individual_parses() {
        // No `'` (so `'` variants share the `Quote::None` parse) and most
        // delimiters absent (so their candidates share one single-field parse).
        let data = b"id,name,score\n1,\"Smith; John\",3.5\n2,Ann,4.0\n3,Bob,2.25\n4,Cy,1.0\n";
        let dialects = crate::dialect::tum::potential_dialects::generate_dialects_with_terminator(LineTerminator::LF);
        let (shared, best) = score_all_dialects_with_best_table(data, &dialects, 0);

        let mut delimiters: Vec<u8> = dialects.iter().map(|d| d.delimiter).collect();
        delimiters.dedup();
        let quote_counts = QuoteCounts::new(data);
        let boundary_counts = QuoteBoundaryCounts::new(data, &delimiters);
        let mut buffers = TypeScoreBuffers::new();
        for d in &dialects {
            let (base, table) = base_score(data, d, 0, &mut buffers);
            let own =
                score_dialect_with_normalized_data(data, d, base.as_ref(), &table, &quote_counts, &boundary_counts);
            let s = shared.iter().find(|s| s.dialect == *d).expect("dialect scored");
            assert_eq!(s.gamma.to_bits(), own.gamma.to_bits(), "{d:?}");
        }

        let (best_dialect, best_table) = best.expect("best table");
        assert_eq!(best_dialect.delimiter, b',');
        assert_eq!(best_table.rows, parse_table_normalized(data, &best_dialect, 0).rows);
    }
}
