use std::collections::HashMap;

type Priority = usize;

pub struct MinHeap<T: std::hash::Hash + std::cmp::Eq + Copy> {
    /// Entries
    entries: Vec<(T, Priority)>,

    /// Value positions
    index: std::collections::HashMap<T, usize>,
}

impl<T: std::hash::Hash + std::cmp::Eq + Copy> MinHeap<T> {
    fn swap(&mut self, a: usize, b: usize) {
        self.index.insert(self.entries[a].0, b);
        self.index.insert(self.entries[b].0, a);
        self.entries.swap(a, b);
    }

    pub fn sift_down(&mut self, index: usize) {
        let mut index = index;

        loop {
            let left = 2 * index + 1;
            let right = 2 * index + 2;
            let previous = index;

            if left < self.entries.len() && self.entries[left].1 < self.entries[index].1 {
                self.swap(left, index);
                index = left;
            }

            if right < self.entries.len() && self.entries[right].1 < self.entries[index].1 {
                self.swap(right, index);
                index = right;
            }

            if index == previous {
                break;
            }
        }
    }

    pub fn sift_up(&mut self, index: usize) {
        let mut index = index;

        loop {
            let parent = (index - 1) / 2;

            if index == 0 || (self.entries[parent].1 <= self.entries[index].1) {
                break;
            }

            self.swap(parent, index);

            index = parent;
        }
    }

    pub fn empty(&self) -> bool {
        self.entries.len() == 0
    }

    pub fn pop(&mut self) -> Option<(T, usize)> {
        if self.entries.len() == 0 {
            return None;
        }

        self.swap(0, self.entries.len() - 1);

        let top = self.entries.pop();

        self.sift_down(0);

        top
    }

    pub fn decrement_key(&mut self, key: T) {
        let index = *self.index.get(&key).unwrap();

        if self.entries[index].1 > 0 {
            self.entries[index].1 -= 1;
            self.sift_up(index);
        }
    }
}

impl<T: std::hash::Hash + std::cmp::Eq + Copy> From<Vec<(T, Priority)>> for MinHeap<T> {
    fn from(entries: Vec<(T, Priority)>) -> Self {
        let mut entries = entries;

        entries.sort_by(|left, right| left.1.cmp(&right.1));

        let index: HashMap<T, usize> = (0..entries.len())
            .into_iter()
            .map(|i| (entries[i].0, i))
            .collect();

        Self { entries, index }
    }
}

impl<T: std::hash::Hash + std::cmp::Eq + Copy> std::iter::FromIterator<(T, Priority)>
    for MinHeap<T>
{
    fn from_iter<I: IntoIterator<Item = (T, Priority)>>(iter: I) -> MinHeap<T> {
        MinHeap::from(iter.into_iter().collect::<Vec<_>>())
    }
}
