import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';

import { LoggerProvider } from '../host/logger_provider.js';
import { LoggerToast } from '../diagnostics/logger_toast.js';
import { GitHubTheme } from '../styles/github_theme.js';
import { TOOLS } from './tool_registry.js';
import * as styles from './tools.module.css';

import '@akohn/dashql-react/fonts/fonts.css';
import '@akohn/dashql-react/styles/colors.css';
import '@akohn/dashql-react/styles/tokens.css';
import '../styles/globals.css';

/// The pages of the tools, loaded when they are opened
const PAGES = new Map(TOOLS.map(tool => [tool.id, React.lazy(tool.load)]));

/// The list of the tools
const ToolIndex: React.FC = () => (
    <div className={styles.index}>
        <h1 className={styles.index_title}>DashQL Tools</h1>
        <ul className={styles.index_list}>
            {TOOLS.map(tool => (
                <li key={tool.id}>
                    <Link className={styles.index_entry} to={`/${tool.id}`}>
                        <span className={styles.index_entry_title}>{tool.title}</span>
                        <span className={styles.index_entry_description}>{tool.description}</span>
                    </Link>
                </li>
            ))}
        </ul>
    </div>
);

/// The page of the tool of the route
const ToolPage: React.FC = () => {
    const { toolId } = useParams();
    const Page = toolId == null ? undefined : PAGES.get(toolId);
    if (Page == null) return <Navigate to="/" replace />;
    return (
        <React.Suspense fallback={<div className={styles.loading}>Loading…</div>}>
            <Page />
        </React.Suspense>
    );
};

/// The tools of DashQL, every tool is a page of its own that sets up only the parts of DashQL it uses, see
/// docs/design/tools.md. The routes are hashes, `tools.html#/<id>`, like those of the demos.
export const Tools: React.FC = () => (
    <HashRouter>
        <LoggerProvider>
            <>
                <LoggerToast />
                <GitHubTheme>
                    <Routes>
                        <Route index element={<ToolIndex />} />
                        <Route path="/:toolId" element={<ToolPage />} />
                    </Routes>
                </GitHubTheme>
            </>
        </LoggerProvider>
    </HashRouter>
);

const element = document.getElementById('root');
createRoot(element!).render(<Tools />);
