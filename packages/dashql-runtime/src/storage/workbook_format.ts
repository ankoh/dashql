import * as core from '@ankoh/dashql-core';

// The storage format of workbooks is a module of the core (`dashql_core_runtime::workbook_format`), see
// docs/wip/core_runtime.md. Its calls need the module instantiated: the synchronous calls of the runtime run once the
// core is there, the asynchronous ones instantiate it when nothing did yet.

/// Instantiates the core for the format when nothing did yet, null for the default module of the package
let coreLoader: (() => Promise<core.DashQL>) | null = null;

/// Set how the format instantiates the core when nothing did yet, e.g. the app fetches the module itself before its
/// provider of the core exists
export function setWorkbookFormatCoreLoader(load: (() => Promise<core.DashQL>) | null): void {
    coreLoader = load;
}

/// The format of a core that the platform provided or the format loaded
let provided: core.DashQLWorkbookFormat | null = null;

/// Provide the core of the platform to the format, e.g. once the app instantiated it. A core may come from another
/// copy of the package, e.g. the one of the page that runs the browser tests.
export function provideWorkbookFormatCore(instance: core.DashQL): void {
    provided ??= instance.workbookFormat;
}

/// The format of the instantiated core. Throws before the core is instantiated.
export function workbookFormat(): core.DashQLWorkbookFormat {
    const format = provided ?? core.DashQL.instantiated()?.workbookFormat;
    if (format == null) {
        throw new Error('The workbook format needs the core, which is not instantiated yet');
    }
    return format;
}

/// The format, the core is instantiated if nothing did yet
export async function loadWorkbookFormat(): Promise<core.DashQLWorkbookFormat> {
    const format = provided ?? core.DashQL.instantiated()?.workbookFormat;
    if (format != null) return format;
    provideWorkbookFormatCore(await (coreLoader ?? (() => core.DashQL.create()))());
    return provided!;
}
