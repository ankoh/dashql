pub struct FileImport {
    pub url: String,
}

pub struct HttpImport {
    pub url: String,
}

pub enum Import {
    File(FileImport),
    Http(HttpImport),
}
