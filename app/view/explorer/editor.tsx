import React from 'react';
import { connect } from 'react-redux';
import dynamic from 'next/dynamic';
import classNames from 'classnames';
import monaco, { Monaco } from '../../monaco-editor';
import { IAppContext, withAppContext } from '../../app_context';
import { RootState } from '../../store';
import { Resizable } from 're-resizable';

import dashqlTheme from './theme_dashql.json';
import styles from './editor.module.scss';

const MonacoEditor = dynamic(import('react-monaco-editor'), { ssr: false });

type Props = ReturnType<typeof mapStateToProps> & {
    appContext: IAppContext;
};

type State = {
    text: string;
    width: number;
    height: number;
    magic: boolean;
};

class Editor extends React.Component<Props, State> {
    editor?: Monaco.editor.IStandaloneCodeEditor;
    decorations: string[] = [];

    ref: HTMLElement | null = null;

    state: State = {
        text: '',
        width: 0,
        height: 0,
        magic: false,
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

    editorWillMount = () => {
        monaco.editor.defineTheme('dashql', {
            ...dashqlTheme,
            base: 'vs',
        });
    };

    editorDidMount = (monaco: Monaco.editor.IStandaloneCodeEditor) => {
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

        if (this.state.magic) {
            this.handleRun();
        }
    };

    handleRun = async () => {
        const { controller } = this.props.appContext;

        await controller.interpreter.eval(this.props.module);
    };

    handleMagic = () => {
        if (!this.state.magic) {
            this.handleRun();
        }

        this.setState({
            magic: !this.state.magic,
        });
    };

    render() {
        return (
            <div className={styles.editor} ref={ref => (this.ref = ref)}>
                <Resizable
                    enable={{
                        top: true,
                    }}
                    size={{
                        width: this.state.width,
                        height: this.state.height,
                    }}
                    onResizeStop={(e, direction, ref, d) => {
                        this.setState({
                            width: this.state.width + d.width,
                            height: this.state.height + d.height,
                        });
                    }}
                >
                    <MonacoEditor
                        editorWillMount={this.editorWillMount}
                        editorDidMount={this.editorDidMount}
                        width={this.state.width}
                        height={this.state.height}
                        language="sql"
                        theme="dashql"
                        value={this.state.text}
                        options={{
                            minimap: {
                                enabled: false,
                            },
                        }}
                        onChange={this.handleChange}
                    />
                    <div className={styles.buttons}>
                        <input
                            type="number"
                            className={styles.font_size_button}
                            defaultValue="12"
                            onChange={event =>
                                this.editor?.updateOptions({
                                    fontSize: event.target.valueAsNumber,
                                })
                            }
                        />
                        <button
                            className={styles.run_button}
                            onClick={this.handleRun}
                        >
                            ▶
                        </button>
                        <button
                            className={classNames(styles.instant_button, {
                                [styles.active]: this.state.magic,
                            })}
                            onClick={this.handleMagic}
                        >
                            ↯
                        </button>
                    </div>
                </Resizable>
            </div>
        );
    }
}

const mapStateToProps = (state: RootState) => ({
    module: state.tqlModule,
    getHighlights: state.tqlGetHighlights,
});

export default connect(mapStateToProps)(withAppContext(Editor));
