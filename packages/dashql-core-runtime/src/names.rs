//! The names of the scripts of a workbook: a script is a file `<name>.sql`, its name is the table parameter that other
//! scripts read.

use std::collections::HashSet;

/// The extension of a script file
const SCRIPT_EXTENSION: &str = ".sql";

/// The name of a script file without its `.sql` extension, compared case-insensitively
pub fn script_display_name(file_name: &str) -> &str {
    let len = file_name.len();
    if len >= SCRIPT_EXTENSION.len() && file_name.is_char_boundary(len - SCRIPT_EXTENSION.len()) {
        let (base, extension) = file_name.split_at(len - SCRIPT_EXTENSION.len());
        if extension.eq_ignore_ascii_case(SCRIPT_EXTENSION) {
            return base;
        }
    }
    file_name
}

/// The first of `base`, `base-2`, `base-3`, ... that no script and no other taken name has, compared
/// case-insensitively. The script `exclude` doesn't count, e.g. the script that is renamed.
pub fn unique_script_base<'a>(
    base: &str,
    script_files: impl IntoIterator<Item = &'a str>,
    exclude: &str,
    taken_names: impl IntoIterator<Item = &'a str>,
) -> String {
    let mut taken: HashSet<String> = script_files
        .into_iter()
        .filter(|file| *file != exclude)
        .map(|file| script_display_name(file).to_lowercase())
        .collect();
    taken.extend(taken_names.into_iter().map(str::to_lowercase));
    let mut candidate = base.to_string();
    let mut suffix = 2;
    while taken.contains(&candidate.to_lowercase()) {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    candidate
}

/// The file name of a new script with a base name, made unique against the scripts and the taken names
pub fn script_file_name<'a>(
    base: &str,
    script_files: impl IntoIterator<Item = &'a str>,
    taken_names: impl IntoIterator<Item = &'a str>,
) -> String {
    format!("{}{SCRIPT_EXTENSION}", unique_script_base(base, script_files, "", taken_names))
}

/// The first of "Untitled", "Untitled 2", ... that no other workbook has, compared case-insensitively
pub fn free_workbook_name<'a>(taken: impl IntoIterator<Item = &'a str>) -> String {
    let taken: HashSet<String> = taken.into_iter().map(|name| name.trim().to_lowercase()).collect();
    if !taken.contains("untitled") {
        return "Untitled".into();
    }
    let mut n = 2;
    while taken.contains(&format!("untitled {n}")) {
        n += 1;
    }
    format!("Untitled {n}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_free_workbook_name() {
        assert_eq!(free_workbook_name([]), "Untitled");
        assert_eq!(free_workbook_name(["untitled ", "Untitled 2", "Sales"]), "Untitled 3");
    }

    #[test]
    fn strips_the_extension_in_any_case() {
        assert_eq!(script_display_name("orders.sql"), "orders");
        assert_eq!(script_display_name("orders.SQL"), "orders");
        assert_eq!(script_display_name("orders"), "orders");
        assert_eq!(script_display_name(".sql"), "");
        assert_eq!(script_display_name("€.sql"), "€");
    }

    #[test]
    fn disambiguates_with_a_suffix() {
        let files = ["orders.sql", "Orders-2.sql"];
        assert_eq!(unique_script_base("report", files, "", []), "report");
        assert_eq!(unique_script_base("orders", files, "", []), "orders-3");
        // The renamed script doesn't take its own name, a taken name counts like a script
        assert_eq!(unique_script_base("orders", files, "orders.sql", []), "orders");
        assert_eq!(unique_script_base("data", files, "", ["DATA"]), "data-2");
        assert_eq!(script_file_name("orders", files, []), "orders-3.sql");
    }
}
