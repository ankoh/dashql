import { gutter, GutterMarker } from '@codemirror/view';

import * as styles from './notebook_shell.module.css';

class ShellPromptMarker extends GutterMarker {
    constructor(private readonly label: string) {
        super();
    }

    eq(other: ShellPromptMarker): boolean {
        return this.label === other.label;
    }

    toDOM(): HTMLElement {
        const marker = document.createElement('span');
        marker.className = styles.prompt_gutter_marker;
        marker.textContent = this.label;
        return marker;
    }
}

export function createShellPromptGutter(prompt: string) {
    const primary = new ShellPromptMarker(`${prompt}>`);
    const continuation = new ShellPromptMarker('...>');
    return gutter({
        class: styles.prompt_gutter,
        lineMarker: (_view, line) => line.from === 0 ? primary : continuation,
        initialSpacer: () => primary,
    });
}
