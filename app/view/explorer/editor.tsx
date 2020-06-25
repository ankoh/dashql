import React from 'react';
import { connect } from 'react-redux';
import dynamic from 'next/dynamic';
import type * as monaco from 'monaco-editor';
import { IAppContext, withAppContext } from '../../app_context';
import { RootState } from '../../store';

import tigonTheme from './theme_tigon.json';
import styles from './editor.module.scss';

const MonacoEditor = dynamic(import('react-monaco-editor'), { ssr: false });

type Props = ReturnType<typeof mapStateToProps> & {
    appContext: IAppContext;
};

type State = {
    text: string;
    width: number;
    height: number;
};

class Editor extends React.Component<Props, State> {
    editor?: monaco.editor.IStandaloneCodeEditor;
    decorations: string[] = [];

    ref: HTMLElement | null = null;

    state: State = {
        text: '',
        width: 0,
        height: 0,
    };

    componentDidMount() {
        this.setDimensions();
    }

    componentDidUpdate() {
        const highlights = this.props.getHighlights.map(getHighlight =>
            getHighlight(),
        );

        const decorations = highlights.map(highlight => {
            const begin = highlight?.getBegin();
            const end = highlight?.getEnd();

            const range = {
                startLineNumber: begin?.getLine() ?? 1,
                startColumn: begin?.getColumn() ?? 1,
                endLineNumber: end?.getLine() ?? 1,
                endColumn: end?.getColumn() ?? 1,
            };

            return {
                range,
                options: { inlineClassName: styles.highlight },
            };
        });

        this.decorations =
            this.editor?.deltaDecorations(this.decorations, decorations) ?? [];
    }

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

    editorWillMount = (monaco_: typeof monaco) => {
        monaco_.editor.defineTheme('tigon', {
            ...tigonTheme,
            base: 'vs',
        });
    };

    editorDidMount = (monaco: monaco.editor.IStandaloneCodeEditor) => {
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

        this.editor = monaco;

        this.props.appContext.controller.editor.registerEditor(monaco);
    };

    handleChange = async (value: string) => {
        this.setState({
            text: value,
        });

        const { controller } = this.props.appContext;

        await controller.editor.evaluate(value);
    };

    render() {
        return (
            <div ref={ref => (this.ref = ref)} style={{ minHeight: 400 }}>
                <MonacoEditor
                    editorWillMount={this.editorWillMount}
                    editorDidMount={this.editorDidMount}
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

const mapStateToProps = (state: RootState) => ({
    getHighlights: state.tqlGetHighlights,
});

export default connect(mapStateToProps)(withAppContext(Editor));
