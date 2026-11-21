import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { LoggerProvider } from '../../host/logger_provider.js';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { LoggerToast } from '../../diagnostics/logger_toast.js';
import { GitHubTheme } from '../../styles/github_theme.js';
import { AnalyzerPage } from './analyzer_page.js';

import '@akohn/dashql-react/fonts/fonts.css';
import '@akohn/dashql-react/styles/colors.css';
import '@akohn/dashql-react/styles/tokens.css';
import '../../styles/globals.css';

/// The analyzer tool, `/tools/analyzer`. A tool sets up only the parts of DashQL it uses (docs/design/tools.md): the
/// logger and the core, whose script sessions scan, parse and analyze the scripts. No runtime, no database.
export const Analyzer: React.FC = () => (
    <LoggerProvider>
        <LoggerToast />
        <GitHubTheme>
            <DashQLCoreProvider>
                <AnalyzerPage />
            </DashQLCoreProvider>
        </GitHubTheme>
    </LoggerProvider>
);

const element = document.getElementById('root');
createRoot(element!).render(<Analyzer />);
