import * as React from 'react';
import * as styles from '../workbook/feed/workbook_composer.module.css';

import { useVersionCheck } from '../host/version/version_check.js';
import { RESULT_OK } from '../utils/result.js';

/// The disk image of the latest stable release of the desktop app, null until the manifest is there
function useDesktopDownload(): URL | null {
    const { stable, latest } = useVersionCheck();
    for (const release of [stable.release, latest.release]) {
        if (release?.type !== RESULT_OK) continue;
        const dmg = release.value.bundles.find(bundle => bundle.bundle_type === 'Dmg');
        if (dmg != null) return dmg.url;
    }
    return null;
}

/// The AI of the prompt in the web app: agents run only in the desktop app, which runs a harness of the machine for a
/// question (docs/design/agent_integration.md)
export const AgentDesktopNotice: React.FC = () => {
    const download = useDesktopDownload();
    return (
        <div className={styles.composer_notice} role="note" data-testid="composer-agent-desktop">
            Ask an agent in the DashQL desktop app: it runs Claude Code, Codex or opencode of your machine on this
            workbook.{' '}
            {download != null
                ? <a href={download.toString()} target="_blank" rel="noreferrer" data-testid="composer-agent-download">Download DashQL for macOS</a>
                : 'The version menu of the top bar lists the downloads.'}
        </div>
    );
};
