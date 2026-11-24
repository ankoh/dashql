import {BrowserWindow, session} from "electron";

import {APP_ORIGIN} from "./app_protocol.js";
import type {ProfileStorage} from "./legacy_profiles.js";

/// The origin private file system of an earlier profile: a hidden window of the app origin in a session over its user
/// data folder. The window shows a blank page, no code of the app runs on the earlier storage.
export async function openLegacyProfile(folder: string): Promise<ProfileStorage> {
    const profile = session.fromPath(folder);
    profile.protocol.handle("app", () => new Response("<!doctype html><title>DashQL</title>", {headers: {"Content-Type": "text/html; charset=utf-8"}}));
    const window = new BrowserWindow({show: false, webPreferences: {session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false}});
    const close = async () => {
        window.destroy();
        profile.protocol.unhandle("app");
    };
    try {
        await window.loadURL(`${APP_ORIGIN}/legacy-profile.html`);
    } catch (error) {
        await close();
        throw error;
    }
    const run = async <T>(code: string): Promise<T> => await window.webContents.executeJavaScript(code) as T;
    return {
        list: async () => await run(`(async () => {
            const entries = [];
            const walk = async (dir, prefix) => {
                for await (const [name, handle] of dir.entries()) {
                    entries.push({path: prefix + name, directory: handle.kind === "directory"});
                    if (handle.kind === "directory") await walk(handle, prefix + name + "/");
                }
            };
            await walk(await navigator.storage.getDirectory(), "");
            return entries;
        })()`),
        read: async (file, offset, length) => await run(`(async (file, offset, length) => {
            const parts = file.split("/");
            const name = parts.pop();
            let dir = await navigator.storage.getDirectory();
            for (const part of parts) dir = await dir.getDirectoryHandle(part);
            const blob = await (await dir.getFileHandle(name)).getFile();
            return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
        })(${JSON.stringify(file)}, ${offset}, ${length})`),
        close,
    };
}
