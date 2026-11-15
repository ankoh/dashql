//! Waiting for the first of several futures of a task, its cancellation and the changes of its controls.

use std::cell::RefCell;
use std::future::{poll_fn, Future};
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use crate::host::HostError;
use crate::http::CancellationToken;

/// A future of the task
pub(crate) type LocalFuture<T> = Pin<Box<dyn Future<Output = T>>>;

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

/// What the controls of a running query say, changed from outside the task
#[derive(Default)]
pub(crate) struct ControlState {
    /// The views that show the profile of the query
    pub(crate) profile_viewers: u32,
    /// Does a channel of the host stream the result? It learns of the views and the cancellation right away.
    host_stream: bool,
    /// The cancellation of the query of a channel of the host at the backend, sent when the query was cancelled
    backend_cancel: Option<LocalFuture<Result<(), HostError>>>,
    /// Did the controls change since the task looked?
    changed: bool,
    waker: Option<Waker>,
}

/// The controls of a running query, shared with the executor
#[derive(Clone, Default)]
pub(crate) struct Controls {
    state: Rc<RefCell<ControlState>>,
}

impl Controls {
    /// Is the profile of the query shown?
    pub(crate) fn profile_shown(&self) -> bool {
        self.state.borrow().profile_viewers > 0
    }

    /// A view starts or stops showing the profile. Returns whether the profile is shown if a channel of the host
    /// streams, the caller tells the channel, otherwise the task learns it.
    pub(crate) fn watch_profile(&self, delta: i32) -> Option<bool> {
        let (waker, host_stream) = {
            let mut state = self.state.borrow_mut();
            state.profile_viewers = state.profile_viewers.saturating_add_signed(delta);
            if state.host_stream {
                (None, Some(state.profile_viewers > 0))
            } else {
                state.changed = true;
                (state.waker.take(), None)
            }
        };
        if let Some(waker) = waker {
            waker.wake();
        }
        host_stream
    }

    /// A channel of the host streams the result, it learns of the views and the cancellation right away from now on
    pub(crate) fn set_host_stream(&self) {
        let mut state = self.state.borrow_mut();
        state.host_stream = true;
        state.changed = false;
    }

    /// Does a channel of the host stream the result?
    pub(crate) fn host_stream(&self) -> bool {
        self.state.borrow().host_stream
    }

    /// Keep the cancellation of the query at the backend, the task waits for it
    pub(crate) fn set_backend_cancel(&self, cancel: impl Future<Output = Result<(), HostError>> + 'static) {
        self.state.borrow_mut().backend_cancel = Some(Box::pin(cancel));
    }

    /// The cancellation of the query at the backend that was sent already
    pub(crate) fn take_backend_cancel(&self) -> Option<LocalFuture<Result<(), HostError>>> {
        self.state.borrow_mut().backend_cancel.take()
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
    controls: &Controls,
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
