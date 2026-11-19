/// Shared colors of the column summary visualizations (histogram, most frequent, etc.), tokens of the theme.
/// They are CSS values, the plots set them as style properties since SVG attributes do not resolve var().

/// Colors for regular (non-null) bars
export const COLUMN_SUMMARY_COLORS = {
    /// Total bar color when no filter is active
    totalBar: "var(--color_neutral_fg)",
    /// Total bar color when focused and no filter is active
    totalBarFocused: "var(--color_fg_muted)",
    /// Total bar color when a filter is active (faded background)
    totalBarWithFilter: "var(--color_border)",
    /// Total bar color when focused and a filter is active
    totalBarWithFilterFocused: "var(--color_fg_subtle)",
    /// Filtered bar color (the highlighted portion)
    filteredBar: "var(--color_neutral_fg)",
    /// Filtered bar color when focused
    filteredBarFocused: "var(--color_fg_muted)",
};

/// Colors for null value bars
export const COLUMN_SUMMARY_NULL_COLORS = {
    /// Total null bar color when no filter is active
    totalBar: "var(--color_fg_subtle)",
    /// Total null bar color when focused and no filter is active
    totalBarFocused: "var(--color_fg_muted)",
    /// Total null bar color when a filter is active (faded background)
    totalBarWithFilter: "var(--color_border)",
    /// Total null bar color when focused and a filter is active
    totalBarWithFilterFocused: "var(--color_fg_subtle)",
    /// Filtered null bar color
    filteredBar: "var(--color_neutral_fg)",
    /// Filtered null bar color when focused
    filteredBarFocused: "var(--color_fg_muted)",
};

/// The color of the baseline below the bars
export const COLUMN_SUMMARY_BASELINE_COLOR = "var(--color_border)";

/// Helper to get the appropriate total bar color based on filter state and focus
export function getTotalBarColor(hasFilter: boolean, isFocused: boolean, isNull: boolean = false): string {
    const colors = isNull ? COLUMN_SUMMARY_NULL_COLORS : COLUMN_SUMMARY_COLORS;
    if (hasFilter) {
        return isFocused ? colors.totalBarWithFilterFocused : colors.totalBarWithFilter;
    }
    return isFocused ? colors.totalBarFocused : colors.totalBar;
}

/// Helper to get the appropriate filtered bar color based on focus
export function getFilteredBarColor(isFocused: boolean, isNull: boolean = false): string {
    const colors = isNull ? COLUMN_SUMMARY_NULL_COLORS : COLUMN_SUMMARY_COLORS;
    return isFocused ? colors.filteredBarFocused : colors.filteredBar;
}
