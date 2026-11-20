//! The progress of the queries of the runtime beyond their views: a `QueryProgressFollower` replays the recording of the
//! progress of a query with another layout of the plan, `replayQueryProgress` replays a recording that was saved. The
//! histories of the queries are part of the `Runtime` (`runtime.rs`), the views of the queries are in `view.rs`.

use dashql_core_runtime::query::progress::{
    replay_recording, ProfileRecording, QueryProgressFollower as RuntimeFollower,
};
use dashql_core_runtime::query::{QueryExecutionHistory, QueryId};
use tsify::Ts;
use wasm_bindgen::prelude::*;

use super::js_error;
use super::views::{from_js, to_js};

pub(crate) mod view;

use view::{ProfileLayoutView, QueryProfileKeys, QueryProfileProgressView};

/// The recording of the progress of a query as JSON
pub(crate) fn progress_recording(history: &QueryExecutionHistory, query_id: QueryId) -> Option<String> {
    let profile = history.query(query_id)?.latest_progress_update.as_ref()?.profile_progress.as_ref()?;
    Some(profile.recording.snapshot().to_json().to_string())
}

/// A follower of the progress of a query: it replays the recording of the progress with a layout of its own, e.g. the
/// other orientation of the plan, and applies the payloads that are recorded later as they come
#[wasm_bindgen]
pub struct QueryProgressFollower {
    follower: RuntimeFollower,
}

impl QueryProgressFollower {
    /// Follow the progress of a query of a history
    pub(crate) fn follow(
        &mut self,
        history: &QueryExecutionHistory,
        query_id: QueryId,
        known: QueryProfileKeys,
    ) -> Result<Option<Ts<QueryProfileProgressView>>, JsError> {
        let recording = history
            .query(query_id)
            .and_then(|query| query.latest_progress_update.as_ref())
            .and_then(|progress| progress.profile_progress.as_ref())
            .map(|profile| profile.recording.clone());
        let Some(recording) = recording else { return Ok(None) };
        self.follower
            .follow(&recording)
            .map(|progress| to_js(&QueryProfileProgressView::of(progress, known)))
            .transpose()
    }
}

/// Replay a recording of the progress of a query (JSON, see `ProfileRecording`) up to a point in time in milliseconds
/// since its first payload, with a layout of the plan or the default one. None if nothing happened until then.
#[wasm_bindgen(js_name = replayQueryProgress)]
pub fn replay_query_progress(
    recording: &str,
    until_ms: f64,
    layout: Option<Ts<ProfileLayoutView>>,
) -> Result<Option<Ts<QueryProfileProgressView>>, JsError> {
    let recording = ProfileRecording::from_json(recording).map_err(js_error)?;
    let layout: Option<dashql_buffers::profile::ProfileLayoutConfig> =
        layout.as_ref().map(from_js).transpose()?.map(Into::into);
    let progress = replay_recording(&recording, until_ms as i64, layout.as_ref());
    progress.map(|progress| to_js(&QueryProfileProgressView::of(&progress, QueryProfileKeys::default()))).transpose()
}

#[wasm_bindgen]
impl QueryProgressFollower {
    /// A follower with the layout of its plans, null for the default one
    #[wasm_bindgen(constructor)]
    pub fn new(layout: Option<Ts<ProfileLayoutView>>) -> Result<QueryProgressFollower, JsError> {
        let layout = layout.as_ref().map(from_js).transpose()?;
        Ok(QueryProgressFollower { follower: RuntimeFollower::new(layout.map(Into::into)) })
    }
}
