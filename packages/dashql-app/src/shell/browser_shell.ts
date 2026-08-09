import type { IDisposable, Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

import {
    DashQLShell,
    DashQLShellCompletionCandidate,
    DashQLShellPrompt,
    DashQLShellPromptAction,
    DashQLShellPromptInput,
} from './api.js';

export interface BrowserShellOptions {
    container: HTMLElement;
    shell: DashQLShell;
    prompt?: string;
    onExit?: () => void;
}

export interface BrowserShellController {
    focus(): void;
    replaceShell(shell: DashQLShell): void;
    writeStatus(message: string): void;
    dispose(): void;
}

function byteOffsetToStringOffset(text: string, byteOffset: number): number {
    const encoder = new TextEncoder();
    let bytes = 0;
    let offset = 0;
    for (const character of text) {
        if (bytes >= byteOffset) break;
        bytes += encoder.encode(character).byteLength;
        offset += character.length;
    }
    return offset;
}

export async function embedDashQLShell(options: BrowserShellOptions): Promise<BrowserShellController> {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
    ]) as [{ Terminal: typeof import('@xterm/xterm').Terminal }, { FitAddon: typeof import('@xterm/addon-fit').FitAddon }, unknown];

    let shell = options.shell;
    let prompt = shell.setPrompt('');
    let activeQuery: AbortController | null = null;
    let disposed = false;
    let renderRows = 1;
    const prefix = options.prompt ?? 'dashql> ';
    const continuation = '     -> ';
    const terminal: Terminal = new Terminal({
        allowProposedApi: false,
        allowTransparency: true,
        convertEol: true,
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: 'Roboto Mono, monospace',
        fontSize: 13,
        screenReaderMode: true,
        scrollback: 10000,
        theme: {
            background: '#00000000',
            foreground: '#e6edf3',
            cursor: '#ffffff',
            selectionBackground: '#264f78',
        },
    });
    const fitAddon: FitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(options.container);
    const helper = options.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    helper?.setAttribute('aria-label', 'DashQL shell input');

    const syncSize = () => {
        if (disposed || options.container.clientWidth === 0 || options.container.clientHeight === 0) return;
        fitAddon.fit();
        shell.resize(Math.max(1, terminal.cols));
    };
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(options.container);

    const renderedPrompt = (value: DashQLShellPrompt) => {
        const lines = value.text.split('\n');
        return lines.map((line, index) => `${index === 0 ? prefix : continuation}${line}`).join('\r\n');
    };
    const redraw = () => {
        for (let i = 0; i < renderRows; ++i) {
            terminal.write('\r\x1b[2K');
            if (i + 1 < renderRows) terminal.write('\x1b[1A');
        }
        const rendered = renderedPrompt(prompt);
        terminal.write(rendered);
        renderRows = Math.max(1, prompt.text.split('\n').length);
        const cursorOffset = byteOffsetToStringOffset(prompt.text, prompt.cursorByteOffset);
        const beforeCursor = prompt.text.slice(0, cursorOffset).split('\n');
        const afterCursor = prompt.text.slice(cursorOffset).split('\n');
        const rowsUp = afterCursor.length - 1;
        const currentLine = beforeCursor[beforeCursor.length - 1];
        const currentPrefix = beforeCursor.length === 1 ? prefix : continuation;
        const cursorColumn = Array.from(currentPrefix + currentLine).length;
        terminal.write('\r');
        if (rowsUp > 0) terminal.write(`\x1b[${rowsUp}A`);
        if (cursorColumn > 0) terminal.write(`\x1b[${cursorColumn}C`);
    };
    const printCompletions = (candidates: DashQLShellCompletionCandidate[]) => {
        terminal.write('\r\n');
        const width = Math.max(1, ...candidates.map(candidate => Array.from(candidate.displayText).length)) + 2;
        const columns = Math.max(1, Math.floor(terminal.cols / width));
        for (let i = 0; i < candidates.length; i += columns) {
            terminal.writeln(candidates.slice(i, i + columns).map(candidate => candidate.displayText.padEnd(width)).join(''));
        }
        renderRows = 1;
        redraw();
    };
    const complete = () => {
        const candidates = shell.completePrompt(50);
        if (candidates.length === 1) {
            prompt = shell.applyCompletion(candidates[0]);
            redraw();
        } else if (candidates.length > 1) {
            printCompletions(candidates);
        }
    };
    const submit = async () => {
        if (activeQuery != null || prompt.text.trim().length === 0) return;
        terminal.write('\r\n');
        renderRows = 1;
        const abort = new AbortController();
        activeQuery = abort;
        try {
            const output = await shell.submitPrompt(abort.signal);
            terminal.writeln(output);
        } catch (error) {
            terminal.writeln(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`);
        } finally {
            if (activeQuery === abort) activeQuery = null;
            prompt = shell.setPrompt('');
            redraw();
        }
    };
    const consume = (key: DashQLShellPromptInput, text = '') => {
        prompt = shell.consumePromptInput(key, text);
        if (prompt.action === DashQLShellPromptAction.SUBMIT) {
            void submit();
        } else if (prompt.action === DashQLShellPromptAction.COMPLETE) {
            complete();
        } else {
            redraw();
        }
    };

    terminal.attachCustomKeyEventHandler(event => {
        if (event.type !== 'keydown' || event.key !== 'Enter') return true;
        if (event.ctrlKey || event.metaKey) {
            consume(DashQLShellPromptInput.FORCE_SUBMIT);
            return false;
        }
        if (event.shiftKey) {
            if (activeQuery == null) consume(DashQLShellPromptInput.TEXT, '\n');
            return false;
        }
        return true;
    });

    const dataSubscription: IDisposable = terminal.onData(data => {
        if (disposed) return;
        if (data === '\x03') {
            if (activeQuery != null) {
                activeQuery.abort();
                terminal.write('^C\r\n');
            } else {
                terminal.write('^C\r\n');
                prompt = shell.consumePromptInput(DashQLShellPromptInput.CANCEL);
                renderRows = 1;
                redraw();
            }
        } else if (activeQuery != null) {
            return;
        } else if (data === '\r') {
            consume(DashQLShellPromptInput.ENTER);
        } else if (data === '\t') {
            consume(DashQLShellPromptInput.TAB);
        } else if (data === '\x7f') {
            consume(DashQLShellPromptInput.BACKSPACE);
        } else if (data === '\x1b[3~') {
            consume(DashQLShellPromptInput.DELETE);
        } else if (data === '\x1b[D') {
            consume(DashQLShellPromptInput.LEFT);
        } else if (data === '\x1b[C') {
            consume(DashQLShellPromptInput.RIGHT);
        } else if (data === '\x1b[A') {
            consume(DashQLShellPromptInput.HISTORY_PREVIOUS);
        } else if (data === '\x1b[B') {
            consume(DashQLShellPromptInput.HISTORY_NEXT);
        } else if (data === '\x1b') {
            options.onExit?.();
        } else if (!data.startsWith('\x1b')) {
            consume(DashQLShellPromptInput.TEXT, data);
        }
    });

    terminal.writeln('\x1b[1mDashQL Shell\x1b[0m');
    terminal.writeln('Terminate SQL with ";". Tab completes. Ctrl+C cancels. Escape returns to the notebook.');
    redraw();
    requestAnimationFrame(() => {
        syncSize();
        terminal.focus();
    });

    return {
        focus: () => terminal.focus(),
        replaceShell(nextShell) {
            const text = prompt.text;
            const history = shell.exportHistory();
            activeQuery?.abort();
            shell = nextShell;
            shell.importHistory(history);
            prompt = shell.setPrompt(text);
            syncSize();
            redraw();
        },
        writeStatus(message) {
            terminal.write('\r\n');
            terminal.writeln(`\x1b[90m${message}\x1b[0m`);
            renderRows = 1;
            redraw();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            activeQuery?.abort();
            dataSubscription.dispose();
            resizeObserver.disconnect();
            terminal.dispose();
        },
    };
}
