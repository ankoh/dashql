import * as React from 'react';

/// The color scheme of the theme, see docs/design/app_theme.md
export type ColorScheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/// The color scheme that the host pinned, null to follow the OS
let currentSetting: ColorScheme | null = null;
const listeners = new Set<() => void>();

/// Pin the document to a color scheme, null follows the OS. The tokens of styles/tokens.css pick their colors by it.
export function applyColorSchemeToDocument(setting: ColorScheme | null, doc: Document = document) {
    if (setting == null) {
        delete doc.documentElement.dataset.colorScheme;
    } else {
        doc.documentElement.dataset.colorScheme = setting;
    }
    if (setting !== currentSetting) {
        currentSetting = setting;
        for (const listener of listeners) {
            listener();
        }
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const media = globalThis.matchMedia?.(DARK_QUERY);
    media?.addEventListener('change', listener);
    return () => {
        listeners.delete(listener);
        media?.removeEventListener('change', listener);
    };
}

/// The color scheme that the document shows now
export function resolveColorScheme(): ColorScheme {
    return currentSetting ?? (globalThis.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light');
}

/// The color scheme the document shows: the pinned one, or the one of the OS.
/// Renders again when it changes, for colors that are not CSS, like the colors of charts drawn on a canvas.
export function useColorScheme(): ColorScheme {
    return React.useSyncExternalStore(subscribe, resolveColorScheme, () => 'light');
}
