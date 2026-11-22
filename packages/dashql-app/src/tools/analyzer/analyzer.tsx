import * as React from 'react';

import { DashQLCoreProvider } from '../../host/core_provider.js';
import { AnalyzerPage } from './analyzer_page.js';

/// The analyzer tool, `tools.html#/analyzer`. A tool sets up only the parts of DashQL it uses (docs/design/tools.md):
/// next to the logger of the tools page, the core, whose script sessions scan, parse and analyze the scripts. No
/// runtime, no database.
const Analyzer: React.FC = () => (
    <DashQLCoreProvider>
        <AnalyzerPage />
    </DashQLCoreProvider>
);

export default Analyzer;
