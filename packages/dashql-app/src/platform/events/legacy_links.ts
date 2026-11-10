/// The names that links of older app versions use.
///
/// Links live outside of the storage and are never rewritten, they are read under every name they
/// ever had. The workbooks the links point to are migrated by the workbook migration.

/// The query parameters that carried the URL of a hosted workbook before workbooks had their name, newest first:
/// workbooks were called sessions, and notebooks before that
export const LEGACY_WORKBOOK_QUERY_PARAMETERS = ['session', 'notebook'];
/// The names of the workbook metadata of a hosted workbook before workbooks had their name, newest first
export const LEGACY_WORKBOOK_FILES = ['dashql-session.json', 'dashql-notebook.json'];

/// Bring the app event of a link to the current names. Links of older versions embed the workbook
/// ZIP as `session`, and before that as `notebook`.
export function migrateAppEventData(data: unknown): unknown {
    if (data == null || typeof data !== 'object' || Array.isArray(data) || !('notebook' in data) || 'session' in data) {
        return data;
    }
    const { notebook, ...rest } = data as Record<string, unknown>;
    return { ...rest, session: notebook };
}
