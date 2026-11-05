import * as React from 'react';

import { useAppConfig, useAppReconfigure } from './app_config.js';

/// The color scheme of the app, see docs/design/app_theme.md
export type ColorScheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/// The color scheme of the app settings, null to follow the OS
let currentSetting: ColorScheme | null = null;
const listeners = new Set<() => void>();

/// Pin the document to the color scheme of the app settings, null follows the OS.
/// Tells the native window of Electron too.
export function applyColorSchemeToDocument(setting: ColorScheme | null, doc: Document = document) {
    if (setting == null) {
        delete doc.documentElement.dataset.colorScheme;
    } else {
        doc.documentElement.dataset.colorScheme = setting;
    }
    globalThis.dashqlElectron?.setColorScheme?.(setting ?? 'system').catch(() => { });
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

function resolveColorScheme(): ColorScheme {
    return currentSetting ?? (globalThis.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light');
}

/// The color scheme the document shows: the one of the app settings, or the one of the OS.
/// Renders again when it changes, for colors that are not CSS, like the colors of charts drawn on a canvas.
export function useColorScheme(): ColorScheme {
    return React.useSyncExternalStore(subscribe, resolveColorScheme, () => 'light');
}

/// Switch to the other color scheme and pin it in the app settings
export function useColorSchemeToggle(): [ColorScheme, () => void] {
    const scheme = useColorScheme();
    const reconfigure = useAppReconfigure();
    const toggle = React.useCallback(() => {
        const next: ColorScheme = resolveColorScheme() === 'dark' ? 'light' : 'dark';
        reconfigure(value => value == null ? null : {
            ...value,
            settings: { ...value.settings, colorScheme: next },
        });
    }, [reconfigure]);
    return [scheme, toggle];
}

/// The color scheme of the app settings, null follows the OS, and a setter of it
export function useColorSchemeSetting(): [ColorScheme | null, (setting: ColorScheme | null) => void] {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const setting = config?.settings?.colorScheme ?? null;
    const set = React.useCallback((next: ColorScheme | null) => {
        reconfigure(value => {
            if (value == null) return null;
            const { colorScheme: _colorScheme, ...settings } = value.settings ?? {};
            return { ...value, settings: next == null ? settings : { ...settings, colorScheme: next } };
        });
    }, [reconfigure]);
    return [setting, set];
}
