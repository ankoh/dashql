use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct FileImport {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpImport {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestImport {
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum Import {
    File(FileImport),
    Http(HttpImport),
    Test(TestImport),
}
