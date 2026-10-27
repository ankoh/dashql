import {describe, expect, it, vi} from "vitest";

import type {AgentHostSnapshot, AgentServerStatus} from "./agent_host.js";
import {buildMenuBarTemplate, title, tooltip, type MenuBarActions} from "./menu_bar_template.js";

function actions(): MenuBarActions {
    return {setAgentAccess: vi.fn(), openWindow: vi.fn(), openWeb: vi.fn(), installUpdate: vi.fn(), quit: vi.fn()};
}

const busy: AgentServerStatus = {
    port: 47100,
    clients: [
        {id: 1, kind: "web", origin: "https://dashql.app", sessions: [{id: "s1", name: "Revenue analysis"}, {id: "s2", name: "Orders"}], focused: "s1"},
        {id: 2, kind: "native", origin: "app://bundle", sessions: [{id: "s3", name: "Scratch"}], focused: null},
    ],
    turns: [
        {turnId: "t1", session: "s1", harness: "codex", state: "running", status: "Writing q1"},
        {turnId: "t2", session: "s3", harness: "claude", state: "queued", status: ""},
    ],
};

function labels(snapshot: AgentHostSnapshot, updateVersion: string | null = null, agentAccess = true): string[] {
    return buildMenuBarTemplate(snapshot, {agentAccess, updateVersion}, actions()).map((item) => item.type === "separator" ? "---" : item.label!);
}

describe("buildMenuBarTemplate", () => {
    it("lists the clients and the turns", () => {
        expect(labels({state: "running", status: busy, error: null})).toEqual([
            "Connected: dashql.app, DashQL window · 3 sessions",
            "Codex · Writing q1 in \"Revenue analysis\"",
            "Claude Code · queued in \"Scratch\"",
            "---",
            "Agent Access",
            "Open DashQL App",
            "Open DashQL Website",
            "---",
            "Quit DashQL",
        ]);
    });

    it("describes a server without clients, one of another process and a dev page", () => {
        const idle = {port: 47101, clients: [], turns: []};
        expect(labels({state: "running", status: idle, error: null})[0]).toBe("Waiting for DashQL on port 47101");
        const dev = {...idle, clients: [{id: 1, kind: "web", origin: "http://localhost:9002", sessions: [{id: "s1", name: "a"}], focused: "s1"}]};
        expect(labels({state: "external", status: dev, error: null}).slice(0, 2)).toEqual([
            "Connected: dev server localhost:9002 · 1 session",
            "Served by another dashql agent serve",
        ]);
    });

    it("describes a server that does not run", () => {
        expect(labels({state: "stopped", status: null, error: null}, null, false)[0]).toBe("Agent access is off");
        expect(labels({state: "starting", status: null, error: null})[0]).toBe("Starting the agent server…");
        const failed = labels({state: "failed", status: null, error: `Port 47100 is taken. ${"x".repeat(100)}`})[0]!;
        expect(failed.startsWith("Agent server failed: Port 47100 is taken.")).toBe(true);
        expect(failed.length).toBe(72);
    });

    it("offers a downloaded update", () => {
        expect(labels({state: "stopped", status: null, error: null}, "1.4.0").slice(-2)).toEqual(["Restart to Update to 1.4.0", "Quit DashQL"]);
    });

    it("calls the actions", () => {
        const called = actions();
        const template = buildMenuBarTemplate({state: "running", status: busy, error: null}, {agentAccess: true, updateVersion: "2.0.0"}, called);
        const click = (label: string) => (template.find((item) => item.label === label)!.click as () => void)();
        expect(template.find((item) => item.label === "Agent Access")).toMatchObject({type: "checkbox", checked: true});
        click("Agent Access");
        click("Open DashQL App");
        click("Open DashQL Website");
        click("Restart to Update to 2.0.0");
        click("Quit DashQL");
        expect(called.setAgentAccess).toHaveBeenCalledWith(false);
        expect(called.openWindow).toHaveBeenCalledOnce();
        expect(called.openWeb).toHaveBeenCalledOnce();
        expect(called.installUpdate).toHaveBeenCalledOnce();
        expect(called.quit).toHaveBeenCalledOnce();
    });
});

describe("the icon", () => {
    it("shows the turns and failures", () => {
        expect(title({state: "running", status: busy, error: null})).toBe("2");
        expect(title({state: "running", status: {...busy, turns: []}, error: null})).toBe("");
        expect(title({state: "failed", status: null, error: "x"})).toBe("!");
        expect(tooltip({state: "running", status: busy, error: null}, true)).toBe("DashQL · 2 agent turns\nConnected: dashql.app, DashQL window · 3 sessions");
    });
});
