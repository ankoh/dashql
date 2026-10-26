import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

import * as styles from './generation_placeholder.module.css';

/// Effect to show the placeholder with a status line, or hide it with null
export const GenerationPlaceholderEffect = StateEffect.define<string | null>();

/// A shimmering line below the script that marks where the agent's SQL will appear, with the agent's latest status
class GenerationPlaceholderWidget extends WidgetType {
    constructor(readonly status: string) {
        super();
    }
    eq(other: GenerationPlaceholderWidget) {
        return other.status === this.status;
    }
    toDOM() {
        const line = document.createElement('div');
        line.className = styles.placeholder_line;
        line.setAttribute('role', 'status');
        line.setAttribute('aria-label', 'The agent is working');
        const bar = document.createElement('span');
        bar.className = styles.placeholder_bar;
        line.appendChild(bar);
        if (this.status.length > 0) {
            const text = document.createElement('span');
            text.className = styles.placeholder_status;
            text.textContent = this.status;
            line.appendChild(text);
        }
        return line;
    }
}

/// The status line of the generation placeholder, null while it is hidden.
/// Block widgets must be provided by a state field, the placeholder follows the end of the document.
export const GenerationPlaceholder = StateField.define<string | null>({
    create: () => null,
    update: (status, tr) => {
        for (const effect of tr.effects) {
            if (effect.is(GenerationPlaceholderEffect)) status = effect.value;
        }
        return status;
    },
    provide: field => EditorView.decorations.compute([field, 'doc'], state => {
        const status = state.field(field);
        return status != null
            ? Decoration.set([
                Decoration.widget({ widget: new GenerationPlaceholderWidget(status), block: true, side: 1 }).range(state.doc.length),
            ])
            : Decoration.none;
    }),
});

/// Show the generation placeholder of an editor with a status line, or hide it with null.
/// Editors start without the placeholder field, the first time it is shown installs it.
export function setGenerationPlaceholder(view: EditorView, status: string | null): void {
    const current = view.state.field(GenerationPlaceholder, false);
    if (current === undefined) {
        if (status != null) view.dispatch({ effects: StateEffect.appendConfig.of(GenerationPlaceholder.init(() => status)) });
    } else if (current !== status) {
        view.dispatch({ effects: GenerationPlaceholderEffect.of(status) });
    }
}
