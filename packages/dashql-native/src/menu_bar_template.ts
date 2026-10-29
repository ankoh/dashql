import type {MenuItemConstructorOptions} from "electron";

import type {AgentServerClient, AgentTurn} from "./agent_bridge.js";
import type {AgentHostSnapshot} from "./agent_host.js";

export interface MenuBarActions {
    setAgentAccess(enabled: boolean): void;
    openWindow(): void;
    openWeb(): void;
    installUpdate(): void;
    quit(): void;
}

/// What the menu shows besides the agent server
export interface MenuBarState {
    /// Whether the agent server should run
    agentAccess: boolean;
    /// The version of a downloaded update
    updateVersion: string | null;
}

const HARNESS_NAMES: Record<string, string> = {
    claude: "Claude Code",
    codex: "Codex",
    opencode: "opencode",
};

export function harnessName(harness: string): string {
    return HARNESS_NAMES[harness] ?? harness;
}

/// How the menu names a page or window that is connected to the agent server
export function clientName(client: AgentServerClient): string {
    if (client.kind === "desktop") return "DashQL window";
    try {
        const url = new URL(client.origin);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1" ? `dev server ${url.host}` : url.host;
    } catch {
        return client.origin;
    }
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/// The first line of the menu
export function statusLine(snapshot: AgentHostSnapshot, agentAccess: boolean): string {
    switch (snapshot.state) {
        case "stopped":
            return agentAccess ? "Agent server stopped" : "Agent access is off";
        case "starting":
            return "Starting the agent server…";
        case "failed":
            return `Agent server failed: ${snapshot.error ?? "unknown error"}`;
        case "running":
        case "external": {
            const status = snapshot.status;
            if (status === null) return "Agent server does not answer";
            if (status.clients.length === 0) return "Waiting for DashQL";
            const names = [...new Set(status.clients.map(clientName))].join(", ");
            const sessions = status.clients.reduce((count, client) => count + client.sessions.length, 0);
            return `Connected: ${names} · ${plural(sessions, "session")}`;
        }
    }
}

/// A line per turn
export function turnLine(turn: AgentTurn, clients: AgentServerClient[]): string {
    const session = clients.flatMap((client) => client.sessions).find((s) => s.id === turn.session);
    const where = `"${session?.name ?? turn.session}"`;
    const what = turn.state === "queued" ? "queued" : turn.status || "running";
    return `${harnessName(turn.harness)} · ${what} in ${where}`;
}

/// The tooltip of the icon
export function tooltip(snapshot: AgentHostSnapshot, agentAccess: boolean): string {
    const turns = snapshot.status?.turns.length ?? 0;
    const line = statusLine(snapshot, agentAccess);
    return turns > 0 ? `DashQL · ${plural(turns, "agent turn")}\n${line}` : `DashQL\n${line}`;
}

/// The title next to the icon: the number of turns, or ! when the server fails
export function title(snapshot: AgentHostSnapshot): string {
    if (snapshot.state === "failed") return "!";
    const turns = snapshot.status?.turns.length ?? 0;
    return turns > 0 ? String(turns) : "";
}

const MAX_LABEL = 72;

function shorten(label: string): string {
    return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

export function buildMenuBarTemplate(snapshot: AgentHostSnapshot, options: MenuBarState, actions: MenuBarActions): MenuItemConstructorOptions[] {
    const clients = snapshot.status?.clients ?? [];
    const items: MenuItemConstructorOptions[] = [{label: shorten(statusLine(snapshot, options.agentAccess)), enabled: false}];
    if (snapshot.status !== null) {
        const owner = snapshot.state === "external" ? " · served by another dashql agent serve" : "";
        items.push({label: `Port ${snapshot.status.port}${owner}`, enabled: false});
    }
    for (const turn of snapshot.status?.turns ?? []) {
        items.push({label: shorten(turnLine(turn, clients)), enabled: false});
    }
    items.push(
        {type: "separator"},
        {
            label: "Agent Access",
            type: "checkbox",
            checked: options.agentAccess,
            click: () => actions.setAgentAccess(!options.agentAccess),
        },
        {label: "Open DashQL App", click: () => actions.openWindow()},
        {label: "Open DashQL Website", click: () => actions.openWeb()},
        {type: "separator"},
    );
    if (options.updateVersion !== null) {
        items.push({label: `Restart to Update to ${options.updateVersion}`, click: () => actions.installUpdate()});
    }
    items.push({label: "Quit DashQL", click: () => actions.quit()});
    return items;
}
