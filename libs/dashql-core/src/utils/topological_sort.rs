use std::{collections::HashMap, hash::Hash};

pub struct TopologicalSort<V>
where
    V: PartialEq + Eq + Hash + Clone,
{
    entries: Vec<(V, usize)>,
    index: HashMap<V, usize>,
}

impl<V> TopologicalSort<V>
where
    V: PartialEq + Eq + Hash + Clone,
{
    /// Constructor
    pub fn new(mut entries: Vec<(V, usize)>) -> Self {
        entries.sort_by_key(|(_, prio)| *prio);
        let mut index = HashMap::new();
        for (i, (v, _)) in entries.iter().enumerate() {
            index.insert(v.clone(), i);
        }
        Self { entries, index }
    }

    /// Swap indices
    pub fn swap_at(&mut self, i: usize, j: usize) {
        self.index.insert(self.entries[i].0.clone(), j);
        self.index.insert(self.entries[j].0.clone(), i);
        let tmp = self.entries[i].clone();
        self.entries[i] = self.entries[j].clone();
        self.entries[j] = tmp;
    }

    /// Sift an element up
    pub fn sift_up(&mut self, mut i: usize) {
        while i != 0 && (self.entries[(i - 1) / 2].1 > self.entries[i].1) {
            let p = (i - 1) / 2;
            self.swap_at(i, p);
            i = p;
        }
    }

    /// Sift an element down
    pub fn sift_down(&mut self, mut i: usize) {
        loop {
            let l = 2 * i + 1;
            let r = 2 * i + 2;
            let prev = i;
            if l < self.entries.len() && self.entries[l].1 < self.entries[i].1 {
                self.swap_at(l, i);
                i = l;
            }
            if r < self.entries.len() && self.entries[r].1 < self.entries[i].1 {
                self.swap_at(r, i);
                i = r;
            }
            if prev == i {
                break;
            }
        }
    }
    /// Heap length
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    /// Heap is empty
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    /// Get the min element
    pub fn top<'a>(&'a self) -> &'a (V, usize) {
        self.entries.first().unwrap()
    }
    /// Pop the min element
    pub fn pop(&mut self) {
        self.swap_at(0, self.entries.len() - 1);
        self.entries.pop();
        self.sift_down(0);
    }
    /// Decrement the key
    pub fn decrement_key(&mut self, k: &V) {
        let i = self.index[k];
        if self.entries[i].1 > 0 {
            self.entries[i].1 -= 1;
            self.sift_up(i);
        }
    }
    /// Get the priority
    pub fn get_priority(&self, k: &V) -> usize {
        let i = self.index.get(k).copied().unwrap();
        self.entries[i].1
    }
}
