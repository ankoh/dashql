pub struct ProgramAnalysisSettings {
    pub default_schema: String,
}

impl Default for ProgramAnalysisSettings {
    fn default() -> Self {
        Self {
            default_schema: "main".to_string(),
        }
    }
}
