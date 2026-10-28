import { isMacDesktopHost } from '../../platform/platform_type.js';
import { useAppConfig } from '../config/app_config.js';

/// Is the app laid out like the desktop app on macOS, with the traffic lights in the top left corner of the window?
/// The Mac Window Layout setting shows this layout in the browser.
export function useMacWindowLayout(): boolean {
    const config = useAppConfig();
    return isMacDesktopHost() || (config?.settings?.macWindowLayout ?? false);
}
