import type {BrowserWindow} from "electron";
import electronUpdater, {type ProgressInfo, type UpdateInfo} from "electron-updater";
import {type UpdateChannel, updateFeedUrlForChannel} from "./update_feed.js";

const {autoUpdater} = electronUpdater;

export type UpdateStatus =
    | {status: "disabled"}
    | {status: "checking"; channel: UpdateChannel}
    | {status: "up-to-date"; channel: UpdateChannel; version: string}
    | {status: "available"; channel: UpdateChannel; version: string}
    | {status: "downloading"; channel: UpdateChannel; version: string; transferred: number; total: number}
    | {status: "downloaded"; channel: UpdateChannel; version: string}
    | {status: "error"; channel: UpdateChannel; message: string};

export interface ElectronUpdater {
    check(channel?: UpdateChannel): Promise<UpdateStatus>;
    download(channel: UpdateChannel): Promise<void>;
    getStatus(): UpdateStatus;
    install(): void;
}

function channelFor(version: string): "canary" | "stable" {
    return version.includes("-") ? "canary" : "stable";
}

export function createElectronUpdater(currentVersion: string, window: () => BrowserWindow | null): ElectronUpdater {
    let status: UpdateStatus = {status: "disabled"};
    let available: UpdateInfo | null = null;
    let availableChannel: UpdateChannel | null = null;
    const installedChannel = channelFor(currentVersion);
    let configuredChannel = installedChannel;

    const publish = (next: UpdateStatus): UpdateStatus => {
        status = next;
        const target = window();
        if (target !== null && !target.isDestroyed()) target.webContents.send("dashql:update-status", next);
        return next;
    };

    const configure = (channel: UpdateChannel) => {
        configuredChannel = channel;
        autoUpdater.allowPrerelease = channel === "canary";
        autoUpdater.allowDowngrade = channel !== installedChannel;
        autoUpdater.setFeedURL({provider: "generic", url: updateFeedUrlForChannel(channel, process.arch)});
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.channel = "latest";
    configure(configuredChannel);
    autoUpdater.on("checking-for-update", () => publish({status: "checking", channel: configuredChannel}));
    autoUpdater.on("update-available", (info) => {
        available = info;
        availableChannel = configuredChannel;
        publish({status: "available", channel: configuredChannel, version: info.version});
    });
    autoUpdater.on("update-not-available", (info) => {
        available = null;
        availableChannel = null;
        publish({status: "up-to-date", channel: configuredChannel, version: info.version});
    });
    autoUpdater.on("download-progress", (progress: ProgressInfo) => publish({
        status: "downloading",
        channel: configuredChannel,
        version: available?.version ?? "",
        transferred: progress.transferred,
        total: progress.total,
    }));
    autoUpdater.on("update-downloaded", (info) => publish({status: "downloaded", channel: configuredChannel, version: info.version}));
    autoUpdater.on("error", (error) => publish({status: "error", channel: configuredChannel, message: error.message}));

    return {
        async check(channel = installedChannel) {
            if (!process.env.DASHQL_ENABLE_DEV_UPDATES && !autoUpdater.isUpdaterActive()) {
                return publish({status: "disabled"});
            }
            configure(channel);
            await autoUpdater.checkForUpdates();
            return status;
        },
        async download(channel) {
            if (available === null || availableChannel !== channel) {
                configure(channel);
                await autoUpdater.checkForUpdates();
            }
            if (available === null || availableChannel !== channel) throw new Error(`No ${channel} update is available`);
            await autoUpdater.downloadUpdate();
        },
        getStatus: () => status,
        install() {
            if (status.status !== "downloaded") throw new Error("No downloaded update is ready");
            autoUpdater.quitAndInstall(false, true);
        },
    };
}
