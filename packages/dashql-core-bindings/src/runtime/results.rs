//! The stored results of the scripts of the workbooks over the results of the platform (docs/design/workbook_results.md).
//!
//! The platform lists, reads, writes, moves and removes the Parquet files of `workbooks/<id>/results/`. These functions
//! decide with `workbook_format::results` of the storage: the names of new files, which file is the result of a script,
//! which files are garbage, and that a script keeps one file. Every function is best-effort where its caller doesn't
//! need the outcome: a failure of the platform is logged, the results are a convenience.

use std::cell::RefCell;

use dashql_core_runtime::host::{Host, HostError, LogLevel};
use dashql_core_runtime::workbook::WorkbookEffect;
use dashql_core_storage::workbook_format::results::{
    files_of_script, result_file_name, sort_result_files, transient_result_file_name, Generations, ResultListing,
    StoredResult,
};

use crate::host::JsPlatform;

/// The target of the log messages of the stored results
pub(crate) const LOG_TARGET: &str = "workbook_results";

/// The results of a workbook: the result of each script and the garbage. `scripts` are the file names of the scripts
/// of the workbook, none keeps the files of every script.
pub(crate) async fn listing(
    platform: &JsPlatform,
    workbook_id: &str,
    scripts: Option<&[String]>,
) -> Result<ResultListing, HostError> {
    let files = platform.results_files(workbook_id).await?;
    let scripts: Option<Vec<&str>> = scripts.map(|scripts| scripts.iter().map(String::as_str).collect());
    Ok(sort_result_files(&files, scripts.as_deref(), platform.now()))
}

/// Remove the garbage of a listing that nobody reads, the files that are read stay for a later listing
pub(crate) async fn remove_garbage(platform: &JsPlatform, workbook_id: &str, listing: &ResultListing) {
    for name in &listing.garbage {
        if let Err(error) = platform.results_remove(workbook_id, name).await {
            platform.log_on(
                LogLevel::Warn,
                "Failed to remove a file of the results",
                &[("workbookId", workbook_id), ("file", name), ("error", error.message())],
                LOG_TARGET,
            );
        }
    }
}

/// The result of a script, pinned until the pin is released: the id of the pin and the file. None if the script has
/// none. A file that another window removes before the pin is none either: the pinned file is looked up again, once it
/// is pinned nobody removes it.
pub(crate) async fn retain(
    platform: &JsPlatform,
    workbook_id: &str,
    script: &str,
) -> Result<Option<(u64, StoredResult)>, HostError> {
    let Some(result) = listing(platform, workbook_id, None).await?.result(script).cloned() else {
        return Ok(None);
    };
    let pin = platform.results_pin(workbook_id, &result.name).await?;
    let present = match platform.results_files(workbook_id).await {
        Ok(files) => files.iter().any(|file| file.name == result.name),
        Err(error) => {
            platform.results_release(pin).await;
            return Err(error);
        }
    };
    if !present {
        platform.results_release(pin).await;
        return Ok(None);
    }
    Ok(Some((pin, result)))
}

thread_local! {
    /// The generations of the new files of the module, in the order they are named
    static GENERATIONS: RefCell<Generations> = RefCell::new(Generations::default());
}

/// The name of a new file of the result of a script, none if the script name makes no file name. Its generation sorts
/// after the generations of the files named before it.
pub(crate) fn new_file_name(platform: &JsPlatform, script: &str, key: &str) -> Result<Option<String>, HostError> {
    let uuid = platform.random_uuid()?;
    let digits: String = uuid.chars().filter(char::is_ascii_hexdigit).take(8).collect();
    let random = u32::from_str_radix(&digits, 16).unwrap_or_default();
    let generation = GENERATIONS.with(|generations| generations.borrow_mut().next(platform.now(), random));
    Ok(result_file_name(script, key, &generation))
}

/// The name of a new transient file
pub(crate) fn new_transient_file_name(platform: &JsPlatform) -> Result<String, HostError> {
    Ok(transient_result_file_name(&platform.random_uuid()?))
}

/// Remove the files of a script, e.g. of one that ran to its end without a result. Files that are read stay, the next
/// listing removes them.
pub(crate) async fn remove_files_of_script(
    platform: &JsPlatform,
    workbook_id: &str,
    script: &str,
) -> Result<(), HostError> {
    let files = platform.results_files(workbook_id).await?;
    for name in files_of_script(&files, script) {
        platform.results_remove(workbook_id, name).await?;
    }
    Ok(())
}

/// A script was renamed: its file follows it under a new generation. A file that is read stays where it is, the next
/// listing removes it with the older files of the old name and the script runs again.
pub(crate) async fn rename_script(
    platform: &JsPlatform,
    workbook_id: &str,
    from: &str,
    to: &str,
) -> Result<(), HostError> {
    let current = listing(platform, workbook_id, None).await?;
    let Some(result) = current.result(from).cloned() else { return Ok(()) };
    let Some(name) = new_file_name(platform, to, &result.key)? else {
        platform.results_remove(workbook_id, &result.name).await?;
        return Ok(());
    };
    if !platform.results_move(workbook_id, &result.name, &name).await? {
        platform.log_on(
            LogLevel::Info,
            "The result of a renamed script is read, it stays until the next listing",
            &[("workbookId", workbook_id), ("from", from), ("to", to)],
            LOG_TARGET,
        );
    }
    Ok(())
}

/// The files of the results follow the effects of an action of a workbook: a renamed script takes its file with it.
/// Nothing without stored results. The files of a deleted script, the older files of a renamed one and a file that a
/// rename left behind, e.g. one that was read, are files of no script or older files of a script: the next listing
/// removes them.
pub(crate) fn follow_effects(platform: &JsPlatform, workbook_id: &str, effects: &[WorkbookEffect]) {
    if !platform.has_results() {
        return;
    }
    for effect in effects {
        let WorkbookEffect::RenameScript { from, to } = effect.clone() else { continue };
        let (platform, workbook_id) = (platform.clone(), workbook_id.to_string());
        platform.clone().spawn(Box::pin(async move {
            if let Err(error) = rename_script(&platform, &workbook_id, &from, &to).await {
                platform.log_on(
                    LogLevel::Warn,
                    "Failed to rename the result of a script",
                    &[("workbookId", workbook_id.as_str()), ("error", error.message())],
                    LOG_TARGET,
                );
            }
        }));
    }
}
