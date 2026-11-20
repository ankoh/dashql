import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function RouterReset() {
    const navigate = useNavigate();
    const location = useLocation();

    // Only the state of the location that the app starts with is dropped
    const resetState = React.useEffectEvent(() => {
        if (location.state) {
            navigate(location.pathname + location.search, { state: null });
        }
    });
    React.useEffect(() => resetState(), []);

    return null;
}
