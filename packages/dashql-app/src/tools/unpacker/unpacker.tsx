import * as React from 'react';

import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { UnpackerPage } from './unpacker_page.js';
import * as styles from './unpacker_page.module.css';

/// The unpacker tool, `tools.html#/unpacker`. A tool sets up only the parts of DashQL it uses (docs/design/tools.md):
/// next to the logger of the tools page, the embedded Hyper that reads the Parquet files, and the core with a runtime
/// without storage, connections or HTTP client, whose computations back the data tables.
const Unpacker: React.FC = () => (
    <EmbeddedDatabaseProvider>
        <DashQLCoreProvider>
            <StandaloneRuntime fallback={<div className={styles.loading}>Loading DashQL…</div>}>
                <UnpackerPage />
            </StandaloneRuntime>
        </DashQLCoreProvider>
    </EmbeddedDatabaseProvider>
);

export default Unpacker;
