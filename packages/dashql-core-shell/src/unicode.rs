//! Text measurement of the tables of the shell: extended grapheme clusters (`unicode-segmentation`) and their widths
//! in characters of a monospace font (`unicode-width`).
//!
//! A cluster occupies the columns of `unicode-width`, a cluster that starts with a control character (like
//! `"\r\n"`) has width 0.

use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

/// The columns of one grapheme cluster
fn cluster_width(cluster: &str) -> usize {
    if cluster.starts_with(char::is_control) {
        0
    } else {
        cluster.width()
    }
}

/// The columns of a text: the sum of its cluster widths
pub fn display_width(text: &str) -> usize {
    text.graphemes(true).map(cluster_width).sum()
}
