use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct CsvLoadInfo {}

#[derive(Debug, Clone, Serialize)]
pub struct ParquetLoadInfo {}

#[derive(Debug, Clone, Serialize)]
pub struct JsonLoadInfo {}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum LoadInfo {
    Csv(CsvLoadInfo),
    Parquet(ParquetLoadInfo),
    Json(JsonLoadInfo),
}
