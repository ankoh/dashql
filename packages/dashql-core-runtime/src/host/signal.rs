//! Signals between the tasks of one thread: a value sent once and a future that can be cancelled.

use std::cell::RefCell;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll, Waker};

struct Slot<T> {
    value: Option<T>,
    closed: bool,
    waker: Option<Waker>,
}

/// Sends one value to its receiver
pub struct Sender<T> {
    slot: Rc<RefCell<Slot<T>>>,
}

/// Receives the value of its sender, none if the sender was dropped without sending
pub struct Receiver<T> {
    slot: Rc<RefCell<Slot<T>>>,
}

/// A channel for one value
pub fn oneshot<T>() -> (Sender<T>, Receiver<T>) {
    let slot = Rc::new(RefCell::new(Slot { value: None, closed: false, waker: None }));
    (Sender { slot: slot.clone() }, Receiver { slot })
}

impl<T> Sender<T> {
    /// Send the value. The receiver wakes up later, never within the call.
    pub fn send(self, value: T) {
        let waker = {
            let mut slot = self.slot.borrow_mut();
            slot.value = Some(value);
            slot.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

impl<T> Drop for Sender<T> {
    fn drop(&mut self) {
        let waker = {
            let mut slot = self.slot.borrow_mut();
            slot.closed = true;
            slot.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

impl<T> Future for Receiver<T> {
    type Output = Option<T>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<T>> {
        let mut slot = self.slot.borrow_mut();
        if let Some(value) = slot.value.take() {
            return Poll::Ready(Some(value));
        }
        if slot.closed {
            return Poll::Ready(None);
        }
        slot.waker = Some(cx.waker().clone());
        Poll::Pending
    }
}

struct CancelState {
    cancelled: bool,
    waker: Option<Waker>,
}

/// Cancels its future
pub struct CancelHandle {
    state: Rc<RefCell<CancelState>>,
}

impl CancelHandle {
    /// Cancel the future. It completes with none and drops what it waited for, e.g. the timer of a sleep.
    pub fn cancel(&self) {
        let waker = {
            let mut state = self.state.borrow_mut();
            state.cancelled = true;
            state.waker.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }
}

/// A future that can be cancelled
pub struct Cancellable<F> {
    future: Option<Pin<Box<F>>>,
    state: Rc<RefCell<CancelState>>,
}

/// Make a future cancellable
pub fn cancellable<F: Future>(future: F) -> (Cancellable<F>, CancelHandle) {
    let state = Rc::new(RefCell::new(CancelState { cancelled: false, waker: None }));
    (Cancellable { future: Some(Box::pin(future)), state: state.clone() }, CancelHandle { state })
}

impl<F: Future> Future for Cancellable<F> {
    type Output = Option<F::Output>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<F::Output>> {
        if self.state.borrow().cancelled {
            self.future = None;
            return Poll::Ready(None);
        }
        let Some(future) = self.future.as_mut() else {
            return Poll::Ready(None);
        };
        match future.as_mut().poll(cx) {
            Poll::Ready(value) => {
                self.future = None;
                Poll::Ready(Some(value))
            }
            Poll::Pending => {
                self.state.borrow_mut().waker = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}
