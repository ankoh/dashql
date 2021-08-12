import * as React from 'react';
import { SystemCard } from './system_card';
import { TerminalLoader } from './terminal_loader';

interface Props {
    className?: string;
    onClose: () => void;
}

export const DatabaseViewer: React.FC<Props> = (props: Props) => (
    <SystemCard title="Database" onClose={props.onClose} className={props.className}>
        <TerminalLoader />
    </SystemCard>
);
