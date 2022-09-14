use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableRef {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ViewRef {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum TaskState {
    FileDataRef(FileDataRef),
    HttpDataRef(HttpDataRef),
    TestDataRef(TestDataRef),
    TableRef(TableRef),
    ViewRef(ViewRef),
}
