import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export function RouterReset() {
    const navigate = useNavigate();
    const location = useLocation();

    React.useEffect(() => {
        if (location.state) {
            navigate(location.pathname + location.search, { state: null });
        }
    }, []);

    return null;
}
