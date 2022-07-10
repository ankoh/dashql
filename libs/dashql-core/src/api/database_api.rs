use crate::external::database::Database;
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

pub type DatabaseID = usize;

pub struct DatabaseAPI {
    databases: HashMap<DatabaseID, Arc<RwLock<Database>>>,
}
