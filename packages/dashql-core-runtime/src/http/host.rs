//! The host that sends HTTP requests, and the cancellation of a task that stops them.
//!
//! `HttpHost::fetch` sends a request with the HTTP client of the platform (fetch, the proxy of the desktop app) and
//! returns the response with any status. A request that fails in the network, or that the token cancelled, fails with a
//! `HostError`. A cancelled request settles right away, the host aborts it.

use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

use super::{HttpRequest, HttpResponse};
use crate::host::{Host, HostError};

/// The message of a request or a task that was cancelled
pub const CANCELLED_MESSAGE: &str = "The request was cancelled";

#[derive(Default)]
struct TokenState {
    cancelled: bool,
    /// The wakers of the futures that wait, by their slot. A future that is dropped takes its waker out.
    wakers: Vec<(u64, Waker)>,
    /// The slot of the next future that waits
    next_slot: u64,
}

/// The cancellation of a task: cancelled once, checked by the task and passed to the requests of the task. Clones share
/// the cancellation.
#[derive(Clone, Default)]
pub struct CancellationToken {
    state: Rc<RefCell<TokenState>>,
}

impl std::fmt::Debug for CancellationToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CancellationToken").field("cancelled", &self.is_cancelled()).finish()
    }
}

impl CancellationToken {
    /// A token that isn't cancelled
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancel. The futures that wait for it wake up later, never within the call.
    pub fn cancel(&self) {
        let wakers = {
            let mut state = self.state.borrow_mut();
            if state.cancelled {
                return;
            }
            state.cancelled = true;
            std::mem::take(&mut state.wakers)
        };
        for (_, waker) in wakers {
            waker.wake();
        }
    }

    /// Was the token cancelled?
    pub fn is_cancelled(&self) -> bool {
        self.state.borrow().cancelled
    }

    /// A future that completes once the token is cancelled
    pub fn cancelled(&self) -> Cancelled {
        Cancelled { token: self.clone(), slot: None }
    }

    /// Run a future until it completes or the token is cancelled, none if the token was cancelled first. The future is
    /// dropped on a cancellation, e.g. a timer is cleared.
    pub fn run<F: Future>(&self, future: F) -> Unless<F> {
        Unless { future: Box::pin(future), cancelled: self.cancelled() }
    }
}

/// Completes once its token is cancelled. It keeps one waker with the token while it waits and takes it out when it
/// is dropped, so a token that lives long, e.g. the one of a catalog update, gathers no wakers of futures that are gone.
pub struct Cancelled {
    token: CancellationToken,
    /// The slot of its waker with the token, none before the first poll
    slot: Option<u64>,
}

impl Future for Cancelled {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        let token = self.token.clone();
        let mut state = token.state.borrow_mut();
        if state.cancelled {
            return Poll::Ready(());
        }
        let slot = match self.slot {
            Some(slot) => slot,
            None => {
                let slot = state.next_slot;
                state.next_slot = state.next_slot.wrapping_add(1);
                self.slot = Some(slot);
                slot
            }
        };
        match state.wakers.iter_mut().find(|(held, _)| *held == slot) {
            Some((_, waker)) => waker.clone_from(cx.waker()),
            None => state.wakers.push((slot, cx.waker().clone())),
        }
        Poll::Pending
    }
}

impl Drop for Cancelled {
    fn drop(&mut self) {
        let Some(slot) = self.slot else { return };
        // While the token wakes its futures their wakers are taken already
        if let Ok(mut state) = self.token.state.try_borrow_mut() {
            state.wakers.retain(|(held, _)| *held != slot);
        }
    }
}

/// A future that stops when its token is cancelled
pub struct Unless<F> {
    future: Pin<Box<F>>,
    cancelled: Cancelled,
}

impl<F: Future> Future for Unless<F> {
    type Output = Option<F::Output>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<F::Output>> {
        if Pin::new(&mut self.cancelled).poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        self.future.as_mut().poll(cx).map(Some)
    }
}

/// A host that sends HTTP requests
pub trait HttpHost: Host {
    /// Send a request and return the response with any status. A request that fails in the network fails with the
    /// error of the host, a request that the token cancelled fails once it is cancelled.
    fn fetch(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::task::Wake;

    struct Flag(std::sync::atomic::AtomicBool);
    impl Wake for Flag {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    #[test]
    fn a_cancelled_token_stops_its_futures() {
        let flag = std::sync::Arc::new(Flag(std::sync::atomic::AtomicBool::new(false)));
        let waker = Waker::from(flag.clone());
        let mut cx = Context::from_waker(&waker);
        let token = CancellationToken::new();
        let mut pending = Box::pin(token.run(std::future::pending::<()>()));
        assert!(pending.as_mut().poll(&mut cx).is_pending());
        token.clone().cancel();
        assert!(flag.0.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(pending.as_mut().poll(&mut cx), Poll::Ready(None));
        assert!(token.is_cancelled());
        let mut ready = Box::pin(CancellationToken::new().run(std::future::ready(1)));
        assert_eq!(ready.as_mut().poll(&mut cx), Poll::Ready(Some(1)));
    }

    #[test]
    fn a_future_that_is_dropped_leaves_no_waker_with_its_token() {
        let flag = std::sync::Arc::new(Flag(std::sync::atomic::AtomicBool::new(false)));
        let waker = Waker::from(flag.clone());
        let mut cx = Context::from_waker(&waker);
        let token = CancellationToken::new();
        for _ in 0..100 {
            let mut waiting = Box::pin(token.cancelled());
            assert!(waiting.as_mut().poll(&mut cx).is_pending());
            assert!(waiting.as_mut().poll(&mut cx).is_pending());
        }
        assert!(token.state.borrow().wakers.is_empty());
        let mut waiting = Box::pin(token.run(std::future::pending::<()>()));
        assert!(waiting.as_mut().poll(&mut cx).is_pending());
        assert_eq!(token.state.borrow().wakers.len(), 1);
        drop(waiting);
        assert!(token.state.borrow().wakers.is_empty());
        // A future that waits still wakes up
        let mut waiting = Box::pin(token.cancelled());
        assert!(waiting.as_mut().poll(&mut cx).is_pending());
        token.cancel();
        assert!(flag.0.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(waiting.as_mut().poll(&mut cx), Poll::Ready(()));
    }
}
