use crate::external::database::NativeDatabase;
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
};

pub type DatabaseID = usize;

pub struct DatabaseAPI {
    databases: HashMap<DatabaseID, Arc<RwLock<NativeDatabase>>>,
}
