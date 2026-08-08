import { gutter, GutterMarker } from '@codemirror/view';

import * as styles from './notebook_shell.module.css';

class ShellPromptMarker extends GutterMarker {
    constructor(
        private readonly label: string,
        private readonly width: number,
    ) {
        super();
    }

    eq(other: ShellPromptMarker): boolean {
        return this.label === other.label && this.width === other.width;
    }

    toDOM(): HTMLElement {
        const marker = document.createElement('span');
        marker.className = styles.prompt_gutter_marker;
        marker.textContent = this.label;
        marker.style.width = `calc(${this.width}ch + 12px)`;
        return marker;
    }
}

export function createShellPromptGutter(prompt: string) {
    const primaryLabel = `${prompt}>`;
    const primary = new ShellPromptMarker(primaryLabel, primaryLabel.length);
    const continuation = new ShellPromptMarker('...>', primaryLabel.length);
    return gutter({
        class: styles.prompt_gutter,
        lineMarker: (_view, line) => line.from === 0 ? primary : continuation,
        initialSpacer: () => primary,
    });
}
