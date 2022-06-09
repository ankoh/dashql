pub struct DatabaseProxy {}

impl DatabaseProxy {
    pub fn connect(&mut self) -> usize {
        42
    }

    pub fn run_query(&mut self, _cid: usize, _query: &str) {}
}
