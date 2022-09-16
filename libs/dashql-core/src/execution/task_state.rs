use serde::Serialize;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct FileDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct HttpDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct TestDataRef {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct TableRef {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct ViewRef {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(tag = "t", content = "v")]
pub enum TaskData {
    FileDataRef(FileDataRef),
    HttpDataRef(HttpDataRef),
    TestDataRef(TestDataRef),
    TableRef(TableRef),
    ViewRef(ViewRef),
}
