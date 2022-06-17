#[derive(Debug, Clone)]
pub struct FileImport {
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct HttpImport {
    pub url: String,
}

#[derive(Debug, Clone)]
pub enum Import {
    File(FileImport),
    Http(HttpImport),
}
