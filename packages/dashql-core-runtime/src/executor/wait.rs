//! Waiting for the first of several futures of a task, its cancellation and the changes of its controls.

use std::cell::RefCell;
use std::future::{poll_fn, Future};
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

use crate::host::LocalFuture;
use crate::http::CancellationToken;

/// Futures by key, e.g. the requests and timers of a query
pub(crate) struct TaskSet<K, T> {
    items: Vec<(K, LocalFuture<T>)>,
}

impl<K: PartialEq + Copy, T> TaskSet<K, T> {
    pub(crate) fn new() -> Self {
        Self { items: Vec::new() }
    }

    /// Add a future under a key
    pub(crate) fn push(&mut self, key: K, future: impl Future<Output = T> + 'static) {
        self.items.push((key, Box::pin(future)));
    }

    /// Drop the future of a key, e.g. a timer that was cleared
    pub(crate) fn remove(&mut self, key: K) {
        self.items.retain(|(existing, _)| *existing != key);
    }

    /// Is no future left?
    pub(crate) fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Wait until every future completed, their outputs are dropped
    pub(crate) async fn settle(&mut self) {
        poll_fn(|cx| {
            self.items.retain_mut(|(_, future)| future.as_mut().poll(cx).is_pending());
            if self.items.is_empty() {
                Poll::Ready(())
            } else {
                Poll::Pending
            }
        })
        .await
    }

    /// Poll the futures in the order they were added, the first that is ready leaves the set
    fn poll_next(&mut self, cx: &mut Context<'_>) -> Poll<Option<(K, T)>> {
        if self.items.is_empty() {
            return Poll::Ready(None);
        }
        let mut ready = None;
        for (index, (key, future)) in self.items.iter_mut().enumerate() {
            if let Poll::Ready(value) = future.as_mut().poll(cx) {
                ready = Some((index, *key, value));
                break;
            }
        }
        match ready {
            Some((index, key, value)) => {
                drop(self.items.remove(index));
                Poll::Ready(Some((key, value)))
            }
            None => Poll::Pending,
        }
    }
}

/// What the controls of a query say, changed from outside its task
#[derive(Default)]
struct ControlState {
    /// The views that show the profile of the query
    profile_viewers: u32,
    /// Did the controls change since the task looked?
    changed: bool,
    waker: Option<Waker>,
}

/// The controls of a query: what the views ask of it. The host keeps them with the run of the query from its
/// registration on, so a view that shows the profile before the query started counts as well.
#[derive(Default)]
pub struct QueryControls {
    state: RefCell<ControlState>,
}

impl QueryControls {
    /// Is the profile of the query shown?
    pub fn profile_shown(&self) -> bool {
        self.state.borrow().profile_viewers > 0
    }

    /// A view starts (`delta` 1) or stops (-1) showing the profile. The task of a Trino query learns it and fetches the
    /// plan and its statistics only then.
    pub fn watch_profile(&self, delta: i32) {
        let waker = {
            let mut state = self.state.borrow_mut();
            state.profile_viewers = state.profile_viewers.saturating_add_signed(delta);
            state.changed = true;
            state.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }

    /// Did the controls change since the last look? Registers the task otherwise.
    fn take_changed(&self, cx: &mut Context<'_>) -> bool {
        let mut state = self.state.borrow_mut();
        if state.changed {
            state.changed = false;
            return true;
        }
        state.waker = Some(cx.waker().clone());
        false
    }

    /// Forget the changes so far, the task applies the controls as they are now
    pub(crate) fn clear_changed(&self) {
        self.state.borrow_mut().changed = false;
    }
}

/// Why a task woke up
pub(crate) enum Wake<K, T> {
    /// The query was cancelled
    Cancelled,
    /// The controls changed
    Control,
    /// A future of the set completed
    Done(K, T),
    /// The set is empty
    Idle,
}

/// Wait for the cancellation, a change of the controls or the first future of the set
pub(crate) async fn next<K: PartialEq + Copy, T>(
    set: &mut TaskSet<K, T>,
    token: &CancellationToken,
    controls: &QueryControls,
) -> Wake<K, T> {
    let mut cancelled = token.cancelled();
    poll_fn(move |cx| {
        if Pin::new(&mut cancelled).poll(cx).is_ready() {
            return Poll::Ready(Wake::Cancelled);
        }
        if controls.take_changed(cx) {
            return Poll::Ready(Wake::Control);
        }
        match set.poll_next(cx) {
            Poll::Ready(Some((key, value))) => Poll::Ready(Wake::Done(key, value)),
            Poll::Ready(None) => Poll::Ready(Wake::Idle),
            Poll::Pending => Poll::Pending,
        }
    })
    .await
}
