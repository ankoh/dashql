import * as React from 'react';

import { useAppConfig, useAppReconfigure } from './app_config.js';
import {
    applyColorSchemeToDocument as applyThemeColorScheme,
    resolveColorScheme,
    useColorScheme,
    type ColorScheme,
} from '@akohn/dashql-react/theme/color_scheme';

// The color scheme of the theme is @akohn/dashql-react's, the app pins it to its settings
export { useColorScheme, type ColorScheme } from '@akohn/dashql-react/theme/color_scheme';

/// Pin the document to the color scheme of the app settings, null follows the OS.
/// Tells the native window of Electron too.
export function applyColorSchemeToDocument(setting: ColorScheme | null, doc: Document = document) {
    applyThemeColorScheme(setting, doc);
    globalThis.dashqlElectron?.setColorScheme?.(setting ?? 'system').catch(() => { });
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
