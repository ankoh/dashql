import * as React from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { AutoSizer } from '../util/autosizer';
import { connect } from 'react-redux';
import { IAppContext, withAppContext } from '../app_context';
import { AppState, AppStateMutations, Dispatch } from '../store';

import { theme as dark_theme } from './editor_theme_dark';
import styles from './editor.module.css';

type Props = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps> & {
    appContext: IAppContext;
};

class Editor extends React.Component<Props> {
    // The monaco container
    protected monacoContainer: HTMLDivElement | null;
    // The monaco editor
    protected editor: monaco.editor.IStandaloneCodeEditor | null;
    // Pending editor resize
    protected pendingEditorResize: number | null;

    /// Constructor
    constructor(props: Props) {
        super(props);
        this.monacoContainer = null;
        this.editor = null;
        this.pendingEditorResize = null;
    }

    /// The component did mount, init monaco
    public componentDidMount() {
        this.initMonaco();
    }

    /// The component did update, sync monaco
    public componentDidUpdate(_prevProps: Props) {
        // Editor not set?
        if (!this.editor) {
            return;
        }
        // Value changed?
        if (this.editor && this.editor.getValue() !== this.props.text) {
            this.editor.setValue(this.props.text);
        }
        // Layout editor
        if (this.monacoContainer) {
            this.resizeEditorDelayed(this.monacoContainer.offsetHeight, this.monacoContainer.offsetWidth);
        }
    }

    /// Init the monaco editor
    protected initMonaco() {
        if (this.monacoContainer) {
            this.editor = monaco.editor.create(this.monacoContainer, {
                fontSize: 14,
                language: "sql",
                value: this.props.text,
                minimap: {
                    enabled: false
                }
            });
            this.editor.setPosition({column: 0, lineNumber: 0});
            this.editor.focus();
            this.props.appContext.ctrl.editor.registerEditor(this.editor);

            // Set theme
            monaco.editor.defineTheme('dashql', dark_theme);
            monaco.editor.setTheme("dashql");

            // Finalize the editor
            this.editorDidMount();
        }
    }

    /// Destroy the monaco editor
    protected destroyMonaco() {
        if (this.editor !== null) {
            this.editor.dispose();
        }
    }

    /// The editor did mount, register the event handler
    public editorDidMount() {
        const editor = this.editor!;
        editor.onDidChangeModelContent((_event) => {
            this.props.updateText(editor.getValue());
        });
        if (this.monacoContainer) {
            this.resizeEditorDelayed(this.monacoContainer.offsetHeight, this.monacoContainer.offsetWidth);
        }
    }

    /// Resize the editor with a delay since this is expensive
    protected resizeEditorDelayed(height: number, width: number) {
        const delayMs = 100;
        if (this.pendingEditorResize != null) {
            clearTimeout(this.pendingEditorResize);
        };
        this.pendingEditorResize = window.setTimeout(() => { this.resizeEditor(height, width) }, delayMs);
    }

    /// Resize the editor
    protected resizeEditor(height: number, width: number) {
        if (this.editor) {
            this.editor.layout({
                height: height,
                width: width,
            })
        }
    }

    /// Render the monaco editor
    render() {
        return (
            <div className={styles.editor}>
                <AutoSizer onResize={(size: {height: number, width: number}) => {this.resizeEditorDelayed(size.height, size.width)}}>
                    {(_size) =>
                        <div
                            className={styles.editor_monaco}
                            ref={(ref) => this.monacoContainer = ref}
                        />
                    }
                </AutoSizer>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    text: state.editorText,
    program: state.editorProgram
});

const mapDispatchToProps = (dispatch: Dispatch) => ({
    updateText: (v: string) => (dispatch(AppStateMutations.setEditorText(v))),
});

export default connect(mapStateToProps, mapDispatchToProps)(withAppContext(Editor));
