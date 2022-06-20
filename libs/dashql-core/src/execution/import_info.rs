use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileImportInfo {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpImportInfo {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestImportInfo {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum ImportInfo {
    File(FileImportInfo),
    Http(HttpImportInfo),
    Test(TestImportInfo),
}
