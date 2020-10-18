use std::collections::HashMap;

type Priority = usize;
pub struct MinHeap<T: std::hash::Hash + std::cmp::Eq + Copy> {
    /// Entries
    entries: Vec<(T, Priority)>,
    /// Value positions
    index: std::collections::HashMap<T, usize>,
}

impl<T: std::hash::Hash + std::cmp::Eq + Copy> MinHeap<T> {

    pub fn from_entries(mut entries: Vec<(T, Priority)>) -> Self {
        entries.sort_by(|l, r| l.1.cmp(&r.1));
        let mut index: HashMap<T, usize> = HashMap::with_capacity(entries.len());
        for i in 0..entries.len() {
            index.insert(entries[i].0, i);
        }
        Self {
            entries,
            index
        }
    }

    fn swap(&mut self, i: usize, j: usize) {
        self.index.insert(self.entries[i].0, j);
        self.index.insert(self.entries[j].0, i);
        self.entries.swap(i, j);
    }

    pub fn sift_down(&mut self, idx: usize) {
        let mut i = idx;
        loop {
            let l = 2 * i + 1;
            let r = 2 * i + 2;
            let prev_i = i;
            if l < self.entries.len() && self.entries[l].1 < self.entries[i].1 {
                self.swap(l, i);
                i = l;
            }
            if r < self.entries.len() && self.entries[r].1 < self.entries[i].1 {
                self.swap(r, i);
                i = r;
            }
            if i == prev_i {
                break;
            }
        }
    }

    pub fn sift_up(&mut self, idx: usize) {
        let mut i = idx;
        loop {
            let p = (i - 1) / 2;
            if i == 0 || (self.entries[p].1 <= self.entries[i].1) {
                break;
            }
            self.swap(p, i);
            i = p;
        }
    }

    pub fn empty(&self) -> bool { self.entries.len() == 0 }

    pub fn pop(&mut self) -> Option<(T, usize)> {
        if self.entries.len() == 0 {
            return None;
        }
        self.swap(0, self.entries.len() - 1);
        let r = self.entries.pop();
        self.sift_down(0);
        return r;
    }

    pub fn decrement_key(&mut self, key: T) {
        let i = *self.index.get(&key).unwrap();
        if self.entries[i].1 > 0 {
            self.entries[i].1 -= 1;
            self.sift_up(i);
        }
    }
}

