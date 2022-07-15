import * as React from 'react';

interface Props {
    children: JSX.Element;
}

export const IPCBackendProvider: React.FC<Props> = (props: Props) => {
    return <div>{props.children}</div>;
};
