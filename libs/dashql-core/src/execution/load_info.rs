use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CsvLoadInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParquetLoadInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JsonLoadInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum LoadInfo {
    Csv(CsvLoadInfo),
    Parquet(ParquetLoadInfo),
    Json(JsonLoadInfo),
}
