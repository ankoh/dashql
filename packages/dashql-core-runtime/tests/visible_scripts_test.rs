// The analyses of the scripts that the editors show, on a fake host: an executor of a single thread and a clock that
// only the test advances. The semantics follow the outdated-script effect of the script editor of the app.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use dashql_core_runtime::host::{Host, LocalTask, LogLevel};
use dashql_core_runtime::visible_scripts::{ScriptAnalyses, VisibleScripts, BACKGROUND_ANALYSIS_DELAY_MS};

// The executor

struct TaskWaker {
    id: u64,
    queue: Arc<Mutex<VecDeque<u64>>>,
}

impl Wake for TaskWaker {
    fn wake(self: Arc<Self>) {
        self.queue.lock().unwrap().push_back(self.id);
    }
}

#[derive(Default)]
struct Executor {
    tasks: RefCell<HashMap<u64, LocalTask>>,
    queue: Arc<Mutex<VecDeque<u64>>>,
    next_id: Cell<u64>,
}

impl Executor {
    fn spawn(&self, task: LocalTask) {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        self.tasks.borrow_mut().insert(id, task);
        self.queue.lock().unwrap().push_back(id);
    }

    fn run_until_stalled(&self) {
        loop {
            let Some(id) = self.queue.lock().unwrap().pop_front() else { return };
            let Some(mut task) = self.tasks.borrow_mut().remove(&id) else { continue };
            let waker = Waker::from(Arc::new(TaskWaker { id, queue: self.queue.clone() }));
            if task.as_mut().poll(&mut Context::from_waker(&waker)).is_pending() {
                self.tasks.borrow_mut().insert(id, task);
            }
        }
    }
}

// The clock

struct TimerSlot {
    fired: Cell<bool>,
    waker: RefCell<Option<Waker>>,
}

#[derive(Default)]
struct Clock {
    now: Cell<u64>,
    next_seq: Cell<u64>,
    timers: RefCell<BTreeMap<(u64, u64), Rc<TimerSlot>>>,
}

struct Sleep {
    clock: Rc<Clock>,
    key: (u64, u64),
    slot: Rc<TimerSlot>,
}

impl Future for Sleep {
    type Output = ();

    fn poll(self: std::pin::Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.slot.fired.get() {
            return Poll::Ready(());
        }
        *self.slot.waker.borrow_mut() = Some(cx.waker().clone());
        Poll::Pending
    }
}

impl Drop for Sleep {
    fn drop(&mut self) {
        self.clock.timers.borrow_mut().remove(&self.key);
    }
}

#[derive(Clone)]
struct FakeHost {
    executor: Rc<Executor>,
    clock: Rc<Clock>,
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        self.clock.now.get() as f64
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let seq = self.clock.next_seq.get();
        self.clock.next_seq.set(seq + 1);
        let key = (self.clock.now.get() + ms.max(0.0).round() as u64, seq);
        let slot = Rc::new(TimerSlot { fired: Cell::new(false), waker: RefCell::new(None) });
        self.clock.timers.borrow_mut().insert(key, slot.clone());
        Sleep { clock: self.clock.clone(), key, slot }
    }

    fn spawn(&self, task: LocalTask) {
        self.executor.spawn(task);
    }

    fn log(&self, _level: LogLevel, _message: &str, _details: &[(&str, &str)]) {}
}

impl FakeHost {
    /// Advance the clock, firing the timers on the way in order
    fn advance(&self, ms: u64) {
        let target = self.clock.now.get() + ms;
        self.executor.run_until_stalled();
        loop {
            let next = self.clock.timers.borrow().iter().next().map(|(key, slot)| (*key, slot.clone()));
            let Some((key, slot)) = next.filter(|(key, _)| key.0 <= target) else { break };
            self.clock.timers.borrow_mut().remove(&key);
            self.clock.now.set(key.0);
            slot.fired.set(true);
            if let Some(waker) = slot.waker.borrow_mut().take() {
                waker.wake();
            }
            self.executor.run_until_stalled();
        }
        self.clock.now.set(target);
    }
}

/// Scripts whose analyses the test outdates, an analysis of one outdates the scripts in `outdates`
#[derive(Default)]
struct Scripts {
    outdated: RefCell<BTreeSet<u32>>,
    analyzed: RefCell<Vec<u32>>,
    outdates: RefCell<HashMap<u32, Vec<u32>>>,
    /// Hears every analysis, like the workbooks that tell the visible scripts of a change
    visible: RefCell<Option<Rc<VisibleScripts<FakeHost>>>>,
}

impl ScriptAnalyses for Scripts {
    fn outdated(&self, key: u32) -> bool {
        self.outdated.borrow().contains(&key)
    }

    fn analyze(&self, key: u32) {
        self.outdated.borrow_mut().remove(&key);
        self.analyzed.borrow_mut().push(key);
        let others = self.outdates.borrow().get(&key).cloned().unwrap_or_default();
        self.outdated.borrow_mut().extend(others);
        let visible = self.visible.borrow().clone();
        if let Some(visible) = visible {
            visible.changed();
        }
    }
}

struct Harness {
    host: FakeHost,
    scripts: Rc<Scripts>,
    visible: Rc<VisibleScripts<FakeHost>>,
}

impl Harness {
    fn new() -> Self {
        let host = FakeHost { executor: Rc::new(Executor::default()), clock: Rc::new(Clock::default()) };
        let scripts = Rc::new(Scripts::default());
        let visible = Rc::new(VisibleScripts::new(host.clone(), BACKGROUND_ANALYSIS_DELAY_MS));
        let weak: std::rc::Weak<dyn ScriptAnalyses> = Rc::downgrade(&(scripts.clone() as Rc<dyn ScriptAnalyses>));
        visible.set_scripts(weak);
        *scripts.visible.borrow_mut() = Some(visible.clone());
        Harness { host, scripts, visible }
    }

    /// Outdate scripts, e.g. by typing in another one, and tell the visible scripts
    fn outdate(&self, keys: &[u32]) {
        self.scripts.outdated.borrow_mut().extend(keys.iter().copied());
        self.visible.changed();
    }

    fn analyzed(&self) -> Vec<u32> {
        std::mem::take(&mut *self.scripts.analyzed.borrow_mut())
    }
}

const DELAY: u64 = BACKGROUND_ANALYSIS_DELAY_MS as u64;

#[test]
fn analyzes_the_selected_script_right_away() {
    let h = Harness::new();
    h.visible.show(1, true);
    h.outdate(&[1]);
    assert_eq!(h.analyzed(), vec![1]);
}

#[test]
fn analyzes_a_shown_script_once_the_changes_pause() {
    let h = Harness::new();
    h.visible.show(2, false);
    h.outdate(&[2]);
    h.host.advance(DELAY - 1);
    assert!(h.analyzed().is_empty());
    // Every change restarts the pause
    h.outdate(&[2]);
    h.host.advance(DELAY - 1);
    assert!(h.analyzed().is_empty());
    h.host.advance(1);
    assert_eq!(h.analyzed(), vec![2]);
    h.host.advance(10 * DELAY);
    assert!(h.analyzed().is_empty());
}

#[test]
fn analyzes_an_outdated_script_when_an_editor_shows_it() {
    let h = Harness::new();
    h.scripts.outdated.borrow_mut().extend([1, 2]);
    h.visible.show(1, true);
    assert_eq!(h.analyzed(), vec![1]);
    h.visible.show(2, false);
    h.host.advance(DELAY);
    assert_eq!(h.analyzed(), vec![2]);
}

#[test]
fn leaves_scripts_alone_that_no_editor_shows() {
    let h = Harness::new();
    h.visible.show(3, false);
    h.visible.show(3, false);
    h.visible.hide(3, false);
    h.outdate(&[3, 4]);
    h.host.advance(DELAY);
    // Still shown by the second editor, the other one is not shown at all
    assert_eq!(h.analyzed(), vec![3]);
    h.visible.hide(3, false);
    h.outdate(&[3]);
    h.host.advance(DELAY);
    assert!(h.analyzed().is_empty());
    assert!(h.visible.shown().is_empty());
}

#[test]
fn analyzes_the_scripts_that_an_analysis_outdates() {
    let h = Harness::new();
    h.visible.show(1, true);
    h.visible.show(2, false);
    // The analysis of the selected script publishes declarations that the shown one resolves against
    h.scripts.outdates.borrow_mut().insert(1, vec![2]);
    h.outdate(&[1]);
    assert_eq!(h.analyzed(), vec![1]);
    h.host.advance(DELAY);
    assert_eq!(h.analyzed(), vec![2]);
}

#[test]
fn a_selection_follows_the_editor() {
    let h = Harness::new();
    h.visible.show(1, false);
    h.visible.hide(1, false);
    h.visible.show(1, true);
    assert_eq!(h.visible.shown(), vec![(1, true)]);
    h.visible.hide(1, true);
    h.visible.show(1, false);
    assert_eq!(h.visible.shown(), vec![(1, false)]);
}
