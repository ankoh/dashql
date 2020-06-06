import React from 'react';
import dynamic from 'next/dynamic';

import tigonTheme from './theme_tigon.json';

const MonacoEditor = dynamic(import('react-monaco-editor'), { ssr: false });

type Props = {};

type State = {
    text: string;
    width: number;
    height: number;
};

class Editor extends React.Component<Props, State> {
    ref: HTMLElement | null = null;

    state: State = {
        text: '',
        width: 0,
        height: 0,
    };

    setDimensions = () => {
        const rect = this.ref?.getBoundingClientRect();

        if (!rect) {
            return;
        }

        this.setState({
            width: rect.width,
            height: rect.height,
        });
    };

    componentDidMount() {
        this.setDimensions();
    }

    handleChange = (value: string) => {
        this.setState({
            text: value,
        });
    };

    render() {
        return (
            <div ref={ref => (this.ref = ref)} style={{ minHeight: 400 }}>
                <MonacoEditor
                    editorWillMount={monaco => {
                        monaco.editor.defineTheme('tigon', {
                            ...tigonTheme,
                            base: 'vs',
                        });
                    }}
                    editorDidMount={() => {
                        (window as any).MonacoEnvironment.getWorkerUrl = (
                            _moduleId: string,
                            label: string,
                        ) => {
                            switch (label) {
                                case 'json':
                                    return '_next/static/json.worker.js';
                                case 'css':
                                    return '_next/static/css.worker.js';
                                case 'html':
                                    return '_next/static/html.worker.js';
                                case 'typescript':
                                case 'javascript':
                                    return '_next/static/ts.worker.js';
                                default:
                                    return '_next/static/editor.worker.js';
                            }
                        };
                    }}
                    width={this.state.width}
                    height={this.state.height}
                    language="sql"
                    theme="tigon"
                    value={this.state.text}
                    options={{
                        minimap: {
                            enabled: false,
                        },
                    }}
                    onChange={this.handleChange}
                />
            </div>
        );
    }
}

export default Editor;
