import type {BrowserWindow} from "electron";
import electronUpdater, {type ProgressInfo, type UpdateInfo} from "electron-updater";
import {updateFeedUrl} from "./update_feed.js";

const {autoUpdater} = electronUpdater;

export type UpdateStatus =
    | {status: "disabled"}
    | {status: "checking"}
    | {status: "up-to-date"; version: string}
    | {status: "available"; version: string}
    | {status: "downloading"; version: string; transferred: number; total: number}
    | {status: "downloaded"; version: string}
    | {status: "error"; message: string};

export interface ElectronUpdater {
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    getStatus(): UpdateStatus;
    install(): void;
}

function channelFor(version: string): "canary" | "stable" {
    return version.includes("-") ? "canary" : "stable";
}

export function createElectronUpdater(currentVersion: string, window: () => BrowserWindow | null): ElectronUpdater {
    let status: UpdateStatus = {status: "disabled"};
    let available: UpdateInfo | null = null;

    const publish = (next: UpdateStatus): UpdateStatus => {
        status = next;
        const target = window();
        if (target !== null && !target.isDestroyed()) target.webContents.send("dashql:update-status", next);
        return next;
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = channelFor(currentVersion) === "canary";
    autoUpdater.channel = "latest";
    autoUpdater.setFeedURL({provider: "generic", url: updateFeedUrl(currentVersion, process.arch)});
    autoUpdater.on("checking-for-update", () => publish({status: "checking"}));
    autoUpdater.on("update-available", (info) => {
        available = info;
        publish({status: "available", version: info.version});
    });
    autoUpdater.on("update-not-available", (info) => {
        available = null;
        publish({status: "up-to-date", version: info.version});
    });
    autoUpdater.on("download-progress", (progress: ProgressInfo) => publish({
        status: "downloading",
        version: available?.version ?? "",
        transferred: progress.transferred,
        total: progress.total,
    }));
    autoUpdater.on("update-downloaded", (info) => publish({status: "downloaded", version: info.version}));
    autoUpdater.on("error", (error) => publish({status: "error", message: error.message}));

    return {
        async check() {
            if (!process.env.DASHQL_ENABLE_DEV_UPDATES && !autoUpdater.isUpdaterActive()) {
                return publish({status: "disabled"});
            }
            await autoUpdater.checkForUpdates();
            return status;
        },
        async download() {
            if (available === null) throw new Error("No update is available");
            await autoUpdater.downloadUpdate();
        },
        getStatus: () => status,
        install() {
            if (status.status !== "downloaded") throw new Error("No downloaded update is ready");
            autoUpdater.quitAndInstall(false, true);
        },
    };
}
