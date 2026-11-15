import { isDesktopHost } from './native_globals.js';

export enum PlatformType {
    WEB = 0,
    /// The desktop app, on any operating system
    DESKTOP = 1,
}

/// The platform the app runs on
export const usePlatformType = (): PlatformType => isDesktopHost() ? PlatformType.DESKTOP : PlatformType.WEB;

/// Does the app run in the desktop app on macOS? The window inlays the traffic lights into the app there.
export const isMacDesktopHost = (): boolean => isDesktopHost() && /Mac/.test(navigator.userAgent);
