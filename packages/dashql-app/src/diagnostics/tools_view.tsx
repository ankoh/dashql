import * as React from 'react';

import { ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ToolsIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';
import { isDesktopHost } from '@akohn/dashql-react/dom/app_host';
import { TOOLS, toolPath, type ToolEntry } from '../tools/tool_registry.js';
import * as styles from './tools_view.module.css';

/// The link of a tool. The web opens the page of the tool next to the app, the desktop app in the browser on
/// dashql.app, its window shows only the app.
function ToolLink(props: { tool: ToolEntry }) {
    const path = toolPath(props.tool.id);
    const openOnDesktop = (event: React.MouseEvent) => {
        const bridge = globalThis.dashqlElectron;
        if (bridge == null) return;
        event.preventDefault();
        void bridge.openExternal(new URL(path, process.env.DASHQL_APP_URL!).href);
    };
    return (
        <a
            className={styles.tool}
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            onClick={isDesktopHost() ? openOnDesktop : undefined}
        >
            <span className={styles.tool_title}>{props.tool.title}</span>
            <span className={styles.tool_description}>{props.tool.description}</span>
        </a>
    );
}

/// The tools of DashQL in the internals overlay, pages of their own, see docs/design/tools.md
export function ToolsView(props: { onClose: () => void }) {
    return (
        <div className={styles.overlay}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <ToolsIcon size={16} />
                    <div className={styles.title}>Tools</div>
                </div>
                <div className={styles.header_right_container}>
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        aria-label="close-overlay"
                        onClick={props.onClose}
                    >
                        <XIcon />
                    </IconButton>
                </div>
            </div>
            <ul className={styles.tools}>
                {TOOLS.map(tool => (
                    <li key={tool.id}>
                        <ToolLink tool={tool} />
                    </li>
                ))}
            </ul>
        </div>
    );
}
