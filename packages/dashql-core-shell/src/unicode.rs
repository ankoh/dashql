//! Text measurement of the tables of the shell: extended grapheme clusters (`unicode-segmentation`) and their widths
//! in characters of a monospace font (`unicode-width`).
//!
//! A cluster occupies the columns of `unicode-width`, a cluster that starts with a control character (like
//! `"\r\n"`) has width 0. Texts that are not valid UTF-8 are measured byte by byte: every byte is a cluster of
//! width 1.

use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// Is the text valid UTF-8?
#[inline]
pub fn is_valid(text: &[u8]) -> bool {
    std::str::from_utf8(text).is_ok()
}

/// The columns of one grapheme cluster
fn cluster_width(cluster: &str) -> usize {
    if cluster.starts_with(char::is_control) {
        0
    } else {
        cluster.width()
    }
}

/// The columns of a text: the sum of its cluster widths, or its byte length if it is not valid UTF-8
pub fn display_width(text: &[u8]) -> usize {
    match std::str::from_utf8(text) {
        Ok(text) => text.graphemes(true).map(cluster_width).sum(),
        Err(_) => text.len(),
    }
}

/// The grapheme clusters of a text as (begin, end) byte ranges, one byte per cluster if it is not valid UTF-8
pub fn graphemes(text: &[u8]) -> Vec<(usize, usize)> {
    match std::str::from_utf8(text) {
        Ok(text) => text.grapheme_indices(true).map(|(begin, cluster)| (begin, begin + cluster.len())).collect(),
        Err(_) => (0..text.len()).map(|begin| (begin, begin + 1)).collect(),
    }
}
