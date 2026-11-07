import * as React from 'react';

import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { FlavorProvider } from '../config/flavor_provider.js';
import { GitHubTheme } from '../styles/github_theme.js';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { getOAuthStateFlavor } from './oauth_redirect_utils.js';
import { getRequestedFlavor } from '../config/flavor_resolution.js';
import { RedirectPage } from './oauth_redirect.js';

import '@ankoh/dashql-ui/fonts/fonts.css';
import '@ankoh/dashql-ui/styles/colors.css';
import '@ankoh/dashql-ui/styles/tokens.css';
import '../styles/globals.css';
import '@ankoh/dashql-ui/styles/flavors/dbcom.css';

// Resolve the flavor before the first render, the page would otherwise flip from DashQL to the flavor.
// The query parameter wins over the flavor carried in the OAuth state.
const flavor = getRequestedFlavor() ?? getOAuthStateFlavor(new URLSearchParams(window.location.search).get('state'));

const element = document.getElementById('root');
const root = createRoot(element!);
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <FlavorProvider requested={flavor}>
                <GitHubTheme>
                    <LoggerProvider>
                        <Routes>
                            <Route path="*" element={<RedirectPage />} />
                        </Routes>
                    </LoggerProvider>
                </GitHubTheme>
            </FlavorProvider>
        </BrowserRouter>
    </React.StrictMode>,
);
