import { DashQLShell, DashQLShellEnvironment, DashQLShellOptions } from '../../../shell/api.js';

export interface SessionShellCatalog {
    relationsSql: string;
    functionsSql: string;
}

export async function createSessionShell(
    catalog: SessionShellCatalog,
    environment: DashQLShellEnvironment,
    options: Omit<DashQLShellOptions, 'environment'> = {},
): Promise<DashQLShell> {
    const shell = await DashQLShell.create({ ...options, environment });
    try {
        shell.loadCatalogScript(catalog.relationsSql);
        shell.loadCatalogScript(catalog.functionsSql);
        return shell;
    } catch (error) {
        shell.destroy();
        throw error;
    }
}
