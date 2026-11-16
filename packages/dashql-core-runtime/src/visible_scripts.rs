//! The analyses of the scripts that the editors show.
//!
//! Typing in one script outdates the analyses of the other scripts on its catalog. The editors tell the runtime which
//! scripts they show and which one is selected: an outdated selected script is analyzed right away, the other shown
//! scripts once the changes pause for a while. Every change restarts the pause. Deferring is safe, a script stays
//! outdated until its analysis ran, and whatever needs an analysis analyzes on demand, e.g. a run of the script. Scripts
//! that no editor shows are not analyzed here.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::{Rc, Weak};

use crate::host::Host;
use crate::workbook::ScriptKey;

/// How long the changes pause before the shown scripts are analyzed in the background
pub const BACKGROUND_ANALYSIS_DELAY_MS: f64 = 150.0;

/// The scripts that the visible scripts are analyzed in
pub trait ScriptAnalyses: 'static {
    /// Is the analysis of a script outdated? False for an unknown script or one that is busy.
    fn outdated(&self, key: ScriptKey) -> bool;
    /// Analyze a script whose analysis is outdated
    fn analyze(&self, key: ScriptKey);
}

/// How often the editors show a script, and how often as the selected one
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Shown {
    editors: u32,
    selected: u32,
}

struct Inner {
    shown: BTreeMap<ScriptKey, Shown>,
    /// Counts the restarts of the pause, a timer of an earlier one does nothing
    generation: u64,
    scripts: Option<Weak<dyn ScriptAnalyses>>,
}

/// The scripts that the editors show, with the timer of their analyses
pub struct VisibleScripts<H: Host + Clone> {
    host: H,
    delay_ms: f64,
    inner: Rc<RefCell<Inner>>,
}

impl<H: Host + Clone> VisibleScripts<H> {
    pub fn new(host: H, delay_ms: f64) -> Self {
        Self { host, delay_ms, inner: Rc::new(RefCell::new(Inner { shown: BTreeMap::new(), generation: 0, scripts: None })) }
    }

    /// Set the scripts to analyze, held weakly
    pub fn set_scripts(&self, scripts: Weak<dyn ScriptAnalyses>) {
        self.inner.borrow_mut().scripts = Some(scripts);
    }

    /// An editor shows a script, selected or not
    pub fn show(&self, key: ScriptKey, selected: bool) {
        {
            let mut inner = self.inner.borrow_mut();
            let shown = inner.shown.entry(key).or_default();
            shown.editors += 1;
            shown.selected += u32::from(selected);
        }
        self.changed();
    }

    /// An editor no longer shows a script, with the selection it was shown with
    pub fn hide(&self, key: ScriptKey, selected: bool) {
        let mut inner = self.inner.borrow_mut();
        let Some(shown) = inner.shown.get_mut(&key) else { return };
        shown.editors = shown.editors.saturating_sub(1);
        shown.selected = shown.selected.saturating_sub(u32::from(selected));
        if shown.editors == 0 {
            inner.shown.remove(&key);
        }
    }

    /// The scripts that the editors show, with whether one is selected
    pub fn shown(&self) -> Vec<(ScriptKey, bool)> {
        self.inner.borrow().shown.iter().map(|(key, shown)| (*key, shown.selected > 0)).collect()
    }

    fn scripts(&self) -> Option<Rc<dyn ScriptAnalyses>> {
        self.inner.borrow().scripts.as_ref().and_then(Weak::upgrade)
    }

    /// The scripts changed: the outdated selected scripts are analyzed now, the pause of the others restarts
    pub fn changed(&self) {
        let Some(scripts) = self.scripts() else { return };
        let shown = self.shown();
        let mut deferred = false;
        for (key, selected) in shown {
            if !scripts.outdated(key) {
                continue;
            }
            if selected {
                scripts.analyze(key);
            } else {
                deferred = true;
            }
        }
        if deferred {
            self.restart_pause();
        }
    }

    /// Analyze the outdated shown scripts once the changes paused
    fn restart_pause(&self) {
        let generation = {
            let mut inner = self.inner.borrow_mut();
            inner.generation += 1;
            inner.generation
        };
        let sleep = self.host.sleep(self.delay_ms);
        let inner = Rc::downgrade(&self.inner);
        self.host.spawn(Box::pin(async move {
            sleep.await;
            let Some(inner) = inner.upgrade() else { return };
            let (keys, scripts) = {
                let inner = inner.borrow();
                if inner.generation != generation {
                    return;
                }
                let keys: Vec<ScriptKey> = inner.shown.keys().copied().collect();
                (keys, inner.scripts.as_ref().and_then(Weak::upgrade))
            };
            let Some(scripts) = scripts else { return };
            for key in keys {
                if scripts.outdated(key) {
                    scripts.analyze(key);
                }
            }
        }));
    }
}
