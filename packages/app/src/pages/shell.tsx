import * as React from 'react';
import { TerminalLoader } from '../components';

interface Props {
    className?: string;
}

class Shell extends React.Component<Props> {
    public render(): React.ReactElement {
        return <TerminalLoader />;
    }
}

export default Shell;
