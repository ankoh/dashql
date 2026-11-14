/// The character that starts a reference to a workbook script, e.g. ":revenue". It is the table parameter of the SQL
/// of DashQL and follows the named parameters of Hyper, ":name".
export const SCRIPT_REFERENCE_PREFIX = ':';

/// Render the reference of a script, as its tag shows it
export function renderScriptReference(name: string): string {
    return `${SCRIPT_REFERENCE_PREFIX}${name}`;
}
