use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileImportInfo {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpImportInfo {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestImportInfo {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum ImportInfo {
    File(FileImportInfo),
    Http(HttpImportInfo),
    Test(TestImportInfo),
}
