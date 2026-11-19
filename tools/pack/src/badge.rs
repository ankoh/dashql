const CHARACTER_WIDTH: usize = 7;
const PERCENT_WIDTH: usize = 11;
const PADDING: usize = 10;

fn value_text_width(value: &str) -> usize {
    value.chars().map(|c| if c == '%' { PERCENT_WIDTH } else { CHARACTER_WIDTH }).sum()
}

fn build_badge(label: &str, label_text_width: usize, value: &str, color: &str) -> String {
    let escaped_value = value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    let label_width = label_text_width + PADDING;
    let value_width = value_text_width(value) + PADDING;
    let width = label_width + value_width;
    let label_center = label_width * 5;
    let value_center = label_width * 10 + value_width * 5;
    let label_text_length = label_text_width * 10;
    let value_text_length = (value_width - PADDING) * 10;
    let title = format!("{label}: {escaped_value}");

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="20" role="img" aria-label="{title}"><title>{title}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="{width}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="{label_width}" height="20" fill="#555"/><rect x="{label_width}" width="{value_width}" height="20" fill="{color}"/><rect width="{width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><text aria-hidden="true" x="{label_center}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{label_text_length}">{label}</text><text x="{label_center}" y="140" transform="scale(.1)" fill="#fff" textLength="{label_text_length}">{label}</text><text aria-hidden="true" x="{value_center}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{value_text_length}">{escaped_value}</text><text x="{value_center}" y="140" transform="scale(.1)" fill="#fff" textLength="{value_text_length}">{escaped_value}</text></g></svg>"##
    )
}

pub fn build_version_badge(version: &str) -> String {
    build_badge("version", 41, version, "#007ec6")
}

// The thresholds and colors of the Coveralls badges, with the green of the license badge from 90 up
fn coverage_color(percentage: f64) -> &'static str {
    if percentage < 80.0 {
        "#e05d44"
    } else if percentage < 90.0 {
        "#dfb317"
    } else {
        "#4c1"
    }
}

pub fn build_coverage_badge(percentage: f64) -> String {
    // The color follows the number on the badge
    let rounded = percentage.round();
    build_badge("coverage", 51, &format!("{rounded}%"), coverage_color(rounded))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_version_badge() {
        let badge = build_version_badge("0.0.7-dev.6");

        assert!(badge.contains("width=\"138\""));
        assert!(badge.contains("aria-label=\"version: 0.0.7-dev.6\""));
        assert!(badge.contains(">version</text>"));
        assert!(badge.contains("fill=\"#007ec6\""));
        assert_eq!(badge.matches(">0.0.7-dev.6</text>").count(), 2);
    }

    #[test]
    fn escapes_version_badge_text() {
        let badge = build_version_badge("1<&\"'>");

        assert!(badge.contains("version: 1&lt;&amp;&quot;&apos;&gt;"));
        assert!(!badge.contains("version: 1<&\"'>"));
    }

    #[test]
    fn builds_coverage_badge() {
        let badge = build_coverage_badge(90.53);

        assert!(badge.contains("width=\"96\""));
        assert!(badge.contains("aria-label=\"coverage: 91%\""));
        assert!(badge.contains(">coverage</text>"));
        assert!(badge.contains("fill=\"#4c1\""));
        assert_eq!(badge.matches(">91%</text>").count(), 2);
    }

    #[test]
    fn colors_coverage_by_thresholds() {
        assert_eq!(coverage_color(0.0), "#e05d44");
        assert_eq!(coverage_color(79.0), "#e05d44");
        assert_eq!(coverage_color(80.0), "#dfb317");
        assert_eq!(coverage_color(89.0), "#dfb317");
        assert_eq!(coverage_color(90.0), "#4c1");
        assert_eq!(coverage_color(100.0), "#4c1");
    }

    #[test]
    fn colors_coverage_by_the_number_on_the_badge() {
        let badge = build_coverage_badge(89.6);
        assert!(badge.contains("aria-label=\"coverage: 90%\""));
        assert!(badge.contains("fill=\"#4c1\""));

        let badge = build_coverage_badge(79.4);
        assert!(badge.contains("aria-label=\"coverage: 79%\""));
        assert!(badge.contains("fill=\"#e05d44\""));
    }
}
