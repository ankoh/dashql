import * as React from 'react';


interface Props {
    url?: string;

    contentComponent: (progress: number) => React.ReactElement;
    progressComponent: (progress: number) => React.ReactElement;
    errorComponent: (error: string) => React.ReactElement;
}

class ScriptLoader extends React.Component<Props> {

}