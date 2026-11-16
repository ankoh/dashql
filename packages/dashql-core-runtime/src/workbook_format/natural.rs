//! The natural order of file and folder names, the order of `Intl.Collator(undefined, { numeric: true, sensitivity:
//! 'base' })`: runs of digits compare by their value ("2_a.sql" before "10_a.sql"), case and the accents of Latin
//! letters don't count.
//!
//! The order of the characters follows the root collation of ICU for ASCII: white space, then punctuation and symbols
//! in the order `_ - , ; : ! ? . ' " ( ) [ ] { } @ * / \ & # % ` ^ + < = > | ~ $`, then digits, then letters. Other
//! characters follow the letters by their code point, an approximation of ICU.

use std::cmp::Ordering;

/// The punctuation and symbols of ASCII in the order of ICU
const PUNCTUATION: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";
/// The white space of ASCII in the order of ICU
const WHITESPACE: &str = "\t\n\u{b}\u{c}\r ";

/// The weight of the digits, between the punctuation and the letters
const DIGIT_WEIGHT: u32 = 500;

/// A Latin letter without its accent, for the letters of Latin-1
fn fold_accent(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'ç' => 'c',
        'è' | 'é' | 'ê' | 'ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' => 'i',
        'ñ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
        'ù' | 'ú' | 'û' | 'ü' => 'u',
        'ý' | 'ÿ' => 'y',
        other => other,
    }
}

/// The primary weight of a character that is no digit
fn weight(c: char) -> u32 {
    let lower = fold_accent(c.to_lowercase().next().unwrap_or(c));
    if let Some(index) = WHITESPACE.find(lower) {
        return index as u32;
    }
    if let Some(index) = PUNCTUATION.find(lower) {
        return 10 + index as u32;
    }
    if lower.is_ascii_lowercase() {
        return 1000 + (lower as u32 - 'a' as u32);
    }
    2000 + lower as u32
}

/// An element of a name: a run of digits without its leading zeros, or another character
enum Element<'a> {
    Digits(&'a str),
    Char(u32),
}

fn elements(name: &str) -> Vec<Element<'_>> {
    let mut out = Vec::new();
    let mut rest = name;
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        if c.is_ascii_digit() {
            let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
            let (digits, tail) = rest.split_at(end);
            let trimmed = digits.trim_start_matches('0');
            out.push(Element::Digits(trimmed));
            rest = tail;
        } else {
            out.push(Element::Char(weight(c)));
            rest = chars.as_str();
        }
        chars = rest.chars();
    }
    out
}

fn compare_element(a: &Element<'_>, b: &Element<'_>) -> Ordering {
    match (a, b) {
        (Element::Digits(a), Element::Digits(b)) => a.len().cmp(&b.len()).then_with(|| a.cmp(b)),
        (Element::Digits(_), Element::Char(w)) => DIGIT_WEIGHT.cmp(w),
        (Element::Char(w), Element::Digits(_)) => w.cmp(&DIGIT_WEIGHT),
        (Element::Char(a), Element::Char(b)) => a.cmp(b),
    }
}

/// Compare two names in natural order. Names that differ only in case or accents are equal.
pub fn natural_compare(a: &str, b: &str) -> Ordering {
    let left = elements(a);
    let right = elements(b);
    for (l, r) in left.iter().zip(right.iter()) {
        let ordering = compare_element(l, r);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    left.len().cmp(&right.len())
}

/// Sort names in natural order, equal names keep their order
pub fn sort_naturally<T>(items: &mut [T], name: impl Fn(&T) -> &str) {
    items.sort_by(|a, b| natural_compare(name(a), name(b)));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_numbers_by_value() {
        let mut names = vec!["10_b.sql", "2_a.sql", "1.sql", "q10", "q2", "B.sql", "a.sql", "_x", "é.sql", "f.sql"];
        sort_naturally(&mut names, |n| n);
        assert_eq!(names, ["_x", "1.sql", "2_a.sql", "10_b.sql", "a.sql", "B.sql", "é.sql", "f.sql", "q2", "q10"]);
        assert_eq!(natural_compare("A.sql", "a.SQL"), Ordering::Equal);
        assert_eq!(natural_compare("a", "a1"), Ordering::Less);
        assert_eq!(natural_compare("page-1", "page-10"), Ordering::Less);
    }
}
