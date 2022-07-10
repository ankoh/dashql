use crate::external::Database;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

pub type DatabaseID = usize;

pub struct DatabaseAPI {
    databases: HashMap<DatabaseID, Arc<Mutex<dyn Database>>>,
}
