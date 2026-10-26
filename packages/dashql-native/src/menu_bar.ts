import {Menu, nativeImage, Tray} from "electron";

import type {AgentHost} from "./agent_host.js";
import {buildMenuBarTemplate, type MenuBarActions, title, tooltip} from "./menu_bar_template.js";

export interface MenuBarOptions {
    /// trayTemplate.png, macOS picks trayTemplate@2x.png next to it and draws it as a template image
    icon: string;
    agentAccess: boolean;
    actions: MenuBarActions;
}

/// The icon of DashQL in the macOS menu bar with the state of the agent server
export class MenuBar {
    readonly #tray: Tray;
    readonly #host: AgentHost;
    readonly #actions: MenuBarActions;
    readonly #unsubscribe: () => void;
    #agentAccess: boolean;
    #updateVersion: string | null = null;

    constructor(host: AgentHost, options: MenuBarOptions) {
        this.#host = host;
        this.#actions = options.actions;
        this.#agentAccess = options.agentAccess;
        const icon = nativeImage.createFromPath(options.icon);
        icon.setTemplateImage(true);
        this.#tray = new Tray(icon);
        this.#unsubscribe = host.onChange(() => this.#render());
        this.#render();
    }

    set agentAccess(enabled: boolean) {
        this.#agentAccess = enabled;
        this.#render();
    }

    set updateVersion(version: string | null) {
        this.#updateVersion = version;
        this.#render();
    }

    destroy(): void {
        this.#unsubscribe();
        this.#tray.destroy();
    }

    #render(): void {
        if (this.#tray.isDestroyed()) return;
        const snapshot = this.#host.snapshot;
        const options = {agentAccess: this.#agentAccess, updateVersion: this.#updateVersion};
        this.#tray.setContextMenu(Menu.buildFromTemplate(buildMenuBarTemplate(snapshot, options, this.#actions)));
        this.#tray.setToolTip(tooltip(snapshot, this.#agentAccess));
        this.#tray.setTitle(title(snapshot), {fontType: "monospacedDigit"});
    }
}
