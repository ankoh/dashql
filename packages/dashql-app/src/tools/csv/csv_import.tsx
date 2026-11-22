import * as React from 'react';

import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { CsvImportPage } from './csv_import_page.js';
import * as styles from './csv_import_page.module.css';

/// The CSV import tool, `tools.html#/csv`. A tool sets up only the parts of DashQL it uses (docs/design/tools.md): next
/// to the logger of the tools page, the embedded Hyper that reads the file, and the core with a runtime without
/// storage, connections or HTTP client, whose computation backs the table. The CSV sniffer is a module of its own that
/// the page loads with the first file.
const CsvImport: React.FC = () => (
    <EmbeddedDatabaseProvider>
        <DashQLCoreProvider>
            <StandaloneRuntime fallback={<div className={styles.loading}>Loading DashQL…</div>}>
                <CsvImportPage />
            </StandaloneRuntime>
        </DashQLCoreProvider>
    </EmbeddedDatabaseProvider>
);

export default CsvImport;
