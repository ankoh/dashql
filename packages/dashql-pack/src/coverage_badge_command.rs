use anyhow::{bail, Context, Result};
use clap::Parser;
use std::path::PathBuf;

use crate::badge::build_coverage_badge;

/// Write the coverage badge of LCOV tracefiles
#[derive(Parser, Debug)]
pub struct CoverageBadgeArgs {
    /// The LCOV tracefiles
    #[arg(required = true)]
    tracefiles: Vec<PathBuf>,
    /// The SVG file to write
    #[arg(long)]
    output: PathBuf,
}

/// The lines hit and the lines found of a tracefile
fn count_lines(tracefile: &str) -> Result<(u64, u64)> {
    let (mut hit, mut found) = (0, 0);
    for line in tracefile.lines() {
        if let Some(count) = line.strip_prefix("LH:") {
            hit += count.parse::<u64>().with_context(|| format!("invalid record: {line}"))?;
        } else if let Some(count) = line.strip_prefix("LF:") {
            found += count.parse::<u64>().with_context(|| format!("invalid record: {line}"))?;
        }
    }
    Ok((hit, found))
}

pub fn coverage_badge(args: CoverageBadgeArgs) -> Result<()> {
    let (mut hit, mut found) = (0, 0);
    for path in &args.tracefiles {
        let tracefile = std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
        let (file_hit, file_found) = count_lines(&tracefile).with_context(|| format!("failed to parse {}", path.display()))?;
        hit += file_hit;
        found += file_found;
    }
    if found == 0 {
        bail!("the tracefiles have no lines");
    }
    let percentage = hit as f64 * 100.0 / found as f64;
    log::info!("line coverage: {percentage:.1}% ({hit} of {found} lines)");
    std::fs::write(&args.output, build_coverage_badge(percentage))
        .with_context(|| format!("failed to write {}", args.output.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_s3::TempDir;

    #[test]
    fn counts_lines_of_all_records() {
        let tracefile = "SF:a.rs\nFN:1,a\nDA:1,1\nLH:3\nLF:4\nend_of_record\nSF:b.rs\nLH:5\nLF:6\nend_of_record\n";
        assert_eq!(count_lines(tracefile).unwrap(), (8, 10));
        assert_eq!(count_lines("").unwrap(), (0, 0));
        assert!(count_lines("LF:x\n").is_err());
    }

    #[test]
    fn writes_the_badge_of_all_tracefiles() {
        let dir = TempDir::new();
        let tracefiles = vec![dir.write("a.dat", b"LH:90\nLF:100\n"), dir.write("b.dat", b"LH:0\nLF:100\n")];
        let output = dir.path().join("badge.svg");
        coverage_badge(CoverageBadgeArgs { tracefiles, output: output.clone() }).unwrap();
        assert!(std::fs::read_to_string(output).unwrap().contains("aria-label=\"coverage: 45%\""));
    }

    #[test]
    fn fails_without_lines() {
        let dir = TempDir::new();
        let tracefiles = vec![dir.write("a.dat", b"")];
        let output = dir.path().join("badge.svg");
        assert!(coverage_badge(CoverageBadgeArgs { tracefiles, output: output.clone() }).is_err());
        assert!(!output.exists());
    }
}
