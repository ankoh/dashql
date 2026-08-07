export function prepareForNotebookTreeNavigation(event: KeyboardEvent) {
    event.preventDefault();

    const active = document.activeElement;
    if (active instanceof HTMLButtonElement) {
        active.blur();
    }
}
