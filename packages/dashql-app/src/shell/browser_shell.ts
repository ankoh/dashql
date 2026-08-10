import type { IDisposable, Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

import { DashQLShell, DashQLShellPromptAction } from './api.js';

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

export async function embedDashQLShell(options: BrowserShellOptions): Promise<BrowserShellController> {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
    ]) as [{ Terminal: typeof import('@xterm/xterm').Terminal }, { FitAddon: typeof import('@xterm/addon-fit').FitAddon }, unknown];

    let shell = options.shell;
    let activeQuery: AbortController | null = null;
    let disposed = false;
    const prompt = options.prompt ?? 'dashql> ';
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

    const submit = async () => {
        if (activeQuery != null) return;
        const abort = new AbortController();
        const executingShell = shell;
        activeQuery = abort;
        try {
            const output = await executingShell.submitPrompt(abort.signal);
            if (!disposed && shell === executingShell) {
                terminal.write(executingShell.finishTerminalQuery(output).data);
            }
        } catch (error) {
            if (!disposed && shell === executingShell) {
                terminal.write(executingShell.finishTerminalQuery(error instanceof Error ? error.message : String(error), true).data);
            }
        } finally {
            if (activeQuery === abort) activeQuery = null;
        }
    };
    const consume = (data: string) => {
        const output = shell.consumeTerminalData(data);
        terminal.write(output.data);
        if (output.action === DashQLShellPromptAction.SUBMIT) void submit();
        else if (output.action === DashQLShellPromptAction.EXIT) options.onExit?.();
    };

    terminal.attachCustomKeyEventHandler(event => {
        if (event.type !== 'keydown' || event.key !== 'Enter') return true;
        if (event.ctrlKey || event.metaKey) {
            consume('\x1f');
            return false;
        }
        if (event.shiftKey) {
            if (activeQuery == null) consume('\n');
            return false;
        }
        return true;
    });

    const dataSubscription: IDisposable = terminal.onData(data => {
        if (disposed) return;
        if (data === '\x03') {
            if (activeQuery != null) activeQuery.abort();
            else consume(data);
        } else if (activeQuery != null) {
            return;
        } else {
            consume(data);
        }
    });

    terminal.write(shell.openTerminal(prompt).data);
    requestAnimationFrame(() => {
        syncSize();
        terminal.focus();
    });

    return {
        focus: () => terminal.focus(),
        replaceShell(nextShell) {
            const history = shell.exportHistory();
            activeQuery?.abort();
            shell = nextShell;
            shell.importHistory(history);
            terminal.write(shell.openTerminal(prompt, false).data);
            syncSize();
        },
        writeStatus(message) {
            terminal.write(shell.renderTerminalStatus(message).data);
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
