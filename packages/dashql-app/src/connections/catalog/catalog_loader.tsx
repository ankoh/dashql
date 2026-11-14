import * as React from 'react';

import { useDynamicConnectionDispatch } from '../connection_registry.js';
import { useSalesforceAPI } from '../salesforce/salesforce_connector.js';
import { useQueryExecutor } from '../query_executor.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { updateHyperCatalog } from '@ankoh/dashql-runtime/connections/hyper/hyper_catalog_update';
import { CatalogLoaderService, type CatalogLoaderDependencies as CatalogLoaderServiceDependencies } from '@ankoh/dashql-runtime/connections/catalog/catalog_loader_service';

// The loader is a service of the runtime (packages/dashql-runtime/src/connections/catalog/catalog_loader_service.ts), this
// module binds it to React
export type { CatalogLoader } from '@ankoh/dashql-runtime/connections/catalog/catalog_loader_service';

/// A function to add a connection id to a catalog loader queue
type RefreshCatalogFn = (connectionId: string, force: boolean) => void;

/// The React context to propagate a active catalog loader queue function
const LOADER_QUEUE_FN_CTX = React.createContext<RefreshCatalogFn | null>(null);

/// The hook to resolve the catalog queue
export const useCatalogLoaderQueue = () => React.useContext(LOADER_QUEUE_FN_CTX)!;

/// The hooks the loader uses, replaced in tests
export interface CatalogLoaderDependencies {
    useDynamicConnectionDispatch: typeof useDynamicConnectionDispatch;
    useQueryExecutor: typeof useQueryExecutor;
    useSalesforceAPI: typeof useSalesforceAPI;
    updateHyperCatalog: typeof updateHyperCatalog;
}

const DEFAULT_DEPENDENCIES: CatalogLoaderDependencies = {
    useDynamicConnectionDispatch,
    useQueryExecutor,
    useSalesforceAPI,
    updateHyperCatalog,
};

/// The props of the catalog loader
export interface CatalogLoaderProviderProps {
    /// The children
    children?: React.ReactElement;
    /// The hooks the loader uses, replaced in tests
    dependencies?: CatalogLoaderDependencies;
    /// Called when the catalog of a connection changed
    onCatalogDidUpdate?: (connectionId: string) => void;
}

export function CatalogLoaderProvider(props: CatalogLoaderProviderProps) {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const logger = useLogger();
    const executor = dependencies.useQueryExecutor();
    const sfapi = dependencies.useSalesforceAPI();
    const [connReg, connDispatch] = dependencies.useDynamicConnectionDispatch();
    const onCatalogDidUpdate = React.useRef(props.onCatalogDidUpdate);
    onCatalogDidUpdate.current = props.onCatalogDidUpdate;

    const deps = React.useMemo<CatalogLoaderServiceDependencies>(() => ({
        logger,
        dispatchConnection: connDispatch,
        execute: executor,
        salesforce: sfapi,
        updateHyperCatalog: dependencies.updateHyperCatalog,
        onCatalogDidUpdate: connectionId => onCatalogDidUpdate.current?.(connectionId),
    }), [logger, connDispatch, executor, sfapi, dependencies.updateHyperCatalog]);

    const [service] = React.useState(() => new CatalogLoaderService(deps));
    React.useEffect(() => {
        service.start();
        return () => service.stop();
    }, [service]);
    React.useEffect(() => service.setDependencies(deps), [service, deps]);
    // The loader follows every registry: connections that come online, relations that statements touched
    React.useEffect(() => service.setRegistry(connReg), [service, connReg]);

    return (
        <LOADER_QUEUE_FN_CTX.Provider value={service.enqueue}>
            {props.children}
        </LOADER_QUEUE_FN_CTX.Provider>
    );
}
