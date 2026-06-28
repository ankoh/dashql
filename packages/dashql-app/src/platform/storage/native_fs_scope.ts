import { invoke } from '@tauri-apps/api/core';
import { isNativePlatform } from '../native_globals.js';

/// Grant the native filesystem scope for a directory.
///
/// Tauri's runtime fs scope is in-memory only and is lost on reload/restart. The OPFS root manifest
/// is the single source of truth for which native directories belong to dashql, so on every boot we
/// re-grant the scope for each relocated session's directory *before* reading it. The grant is
/// performed by the custom `grant_fs_scope` Rust command (`app.fs_scope().allow_directory(dir,
/// true)`), which is idempotent.
///
/// On the web there is no native filesystem (and no Tauri bridge), so this is a no-op.
export async function grantFsScope(path: string): Promise<void> {
    if (!isNativePlatform()) {
        return;
    }
    await invoke('grant_fs_scope', { path });
}
