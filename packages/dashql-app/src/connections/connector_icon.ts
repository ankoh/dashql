import * as React from 'react';

import { ConnectorInfo } from './connector_info.js';
import { useColorScheme } from '../config/color_scheme.js';

/// The symbol of the icon of a connector in the color scheme of the app.
/// The light scheme shows the colored logos, the dark scheme the monochrome ones, which take the color of the text.
export function useConnectorIcon(): (info: ConnectorInfo) => string {
    const scheme = useColorScheme();
    return React.useCallback((info: ConnectorInfo) => scheme === 'dark' ? info.icons.uncolored : info.icons.colored, [scheme]);
}
