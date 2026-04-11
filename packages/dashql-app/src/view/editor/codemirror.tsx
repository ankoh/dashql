import * as React from 'react';
import * as themes from './themes/index.js';

import { EditorState, Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { DashQLExtensions } from './dashql_extension.js';

import { useLogger } from '../../platform/logger/logger_provider.js';

import './codemirror.css';

export interface CodeMirrorProps {
    /// Root of the DOM where the editor is mounted
    root?: ShadowRoot | Document;
    /// Override styles for the container div (e.g. height: 'auto' for auto-expand)
    style?: React.CSSProperties;
    /// Additional extensions appended after the default set
    extraExtensions?: Extension[];
    /// Full extension set to use instead of defaults
    extensions?: Extension[];
}

export function createCodeMirrorExtensions(): Extension[] {
    // See: https://github.com/codemirror/basic-setup/blob/main/src/codemirror.ts
    // We might want to add other plugins later.
    const keymapExtension = keymap.of([
        ...defaultKeymap,
        ...historyKeymap
    ]);
    const extensions: Extension[] = [
        themes.xcode.xcodeLight,
        lineNumbers(),
        history(),
        ...DashQLExtensions,
        keymapExtension
    ];
    return extensions;
}

export const CodeMirror = React.forwardRef<EditorView, CodeMirrorProps>((props: CodeMirrorProps, ref) => {
    const logger = useLogger();

    const [node, setNode] = React.useState<HTMLDivElement | null>(null);

    React.useEffect(() => {
        // Not mounted yet?
        // Then do nothing.
        if (node == null) {
            return () => { };
        }
        logger.info("creating a new codemirror view", {}, "codemirror");

        // The DOM node has changed, create a new view
        const extensions = props.extensions ?? [...createCodeMirrorExtensions(), ...(props.extraExtensions ?? [])];
        const view = new EditorView({
            state: EditorState.create({ extensions }),
            parent: node,
            root: props.root,
        });

        // Forward the ref
        if (typeof ref === 'function') {
            ref(view);
        } else if (ref) {
            ref.current = view;
        }

        // Destroy the view when unmounting
        return () => {
            view.destroy();
        };
    }, [node, ref]);


    return <div style={{ width: '100%', height: '100%', ...props.style }} ref={setNode}></div>;
});
