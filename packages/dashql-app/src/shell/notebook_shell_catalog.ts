import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from '../connection/catalog_update_state.js';
import { DashQLShell, DashQLShellEnvironment, DashQLShellOptions } from './api.js';

export interface NotebookShellCatalog {
    relationsSql: string;
    functionsSql: string;
}

export async function createNotebookShell(
    catalog: NotebookShellCatalog,
    environment: DashQLShellEnvironment,
    options: Omit<DashQLShellOptions, 'environment'> = {},
): Promise<DashQLShell> {
    const shell = await DashQLShell.create({ ...options, environment });
    try {
        shell.loadCatalogScript(catalog.relationsSql, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
        shell.loadCatalogScript(catalog.functionsSql, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
        return shell;
    } catch (error) {
        shell.destroy();
        throw error;
    }
}
