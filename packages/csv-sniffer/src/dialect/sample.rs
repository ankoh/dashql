/// Sample size configuration for sniffing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleSize {
    /// Sample a specific number of records.
    Records(usize),
    /// Sample a specific number of bytes.
    Bytes(usize),
    /// Read the entire file.
    ///
    /// # Warning
    ///
    /// This loads the entire file into memory. For large files (e.g., >100 MB), prefer
    /// [`SampleSize::Bytes`] with a reasonable limit to avoid excessive memory usage.
    All,
}

impl Default for SampleSize {
    fn default() -> Self {
        // Default to 100 records which is reasonable for most files
        SampleSize::Records(100)
    }
}

impl SampleSize {
    /// Returns the number of records to sample, or None for All.
    pub fn records(&self) -> Option<usize> {
        match self {
            SampleSize::Records(n) => Some(*n),
            _ => None,
        }
    }

    /// Returns the number of bytes to sample, or None for other modes.
    pub fn bytes(&self) -> Option<usize> {
        match self {
            SampleSize::Bytes(n) => Some(*n),
            _ => None,
        }
    }
}

/// Date format preference for ambiguous date parsing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DatePreference {
    /// Day-Month-Year format (e.g., 31/12/2023).
    DmyFormat,
    /// Month-Day-Year format (e.g., 12/31/2023).
    #[default]
    MdyFormat,
}

impl DatePreference {
    /// Returns true if day comes before month in ambiguous dates.
    pub fn is_dmy(&self) -> bool {
        matches!(self, DatePreference::DmyFormat)
    }
}
