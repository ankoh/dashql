import type {MenuItemConstructorOptions} from "electron";

import type {AgentClientStatus, AgentHostSnapshot, AgentRunStatus} from "./agent_host.js";

export interface MenuBarActions {
    setAgentAccess(enabled: boolean): void;
    openWindow(): void;
    openWeb(): void;
    installUpdate(): void;
    quit(): void;
}

export interface MenuBarOptions {
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
export function clientName(client: AgentClientStatus): string {
    if (client.kind === "native") return "DashQL window";
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
            if (status.clients.length === 0) return `Waiting for DashQL on port ${status.port}`;
            const names = [...new Set(status.clients.map(clientName))].join(", ");
            const sessions = status.clients.reduce((count, client) => count + client.sessions.length, 0);
            return `Connected: ${names} · ${plural(sessions, "session")}`;
        }
    }
}

/// A line per harness run
export function runLine(run: AgentRunStatus, clients: AgentClientStatus[]): string {
    const session = clients.flatMap((client) => client.sessions).find((s) => s.id === run.session);
    const where = `"${session?.name ?? run.session}"`;
    const what = run.state === "queued" ? "queued" : run.status || "running";
    return `${harnessName(run.harness)} · ${what} in ${where}`;
}

/// The tooltip of the icon
export function tooltip(snapshot: AgentHostSnapshot, agentAccess: boolean): string {
    const runs = snapshot.status?.runs.length ?? 0;
    const line = statusLine(snapshot, agentAccess);
    return runs > 0 ? `DashQL · ${plural(runs, "agent run")}\n${line}` : `DashQL\n${line}`;
}

/// The title next to the icon: the number of harness runs, or ! when the server fails
export function title(snapshot: AgentHostSnapshot): string {
    if (snapshot.state === "failed") return "!";
    const runs = snapshot.status?.runs.length ?? 0;
    return runs > 0 ? String(runs) : "";
}

const MAX_LABEL = 72;

function shorten(label: string): string {
    return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

export function buildMenuBarTemplate(snapshot: AgentHostSnapshot, options: MenuBarOptions, actions: MenuBarActions): MenuItemConstructorOptions[] {
    const clients = snapshot.status?.clients ?? [];
    const items: MenuItemConstructorOptions[] = [{label: shorten(statusLine(snapshot, options.agentAccess)), enabled: false}];
    if (snapshot.state === "external") {
        items.push({label: "Served by another dashql agent serve", enabled: false});
    }
    for (const run of snapshot.status?.runs ?? []) {
        items.push({label: shorten(runLine(run, clients)), enabled: false});
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
