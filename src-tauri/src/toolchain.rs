//! Locate an installed Arm GNU toolchain (arm-none-eabi-gcc) on this machine.
//! Detection order: explicit env override, PATH probe, then known install roots.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const ENV_OVERRIDE: &str = "ECROADMAP_ARM_GCC";
const GCC_EXE: &str = "arm-none-eabi-gcc";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainInfo {
    pub found: bool,
    pub gcc: String,
    pub version: String,
}

impl ToolchainInfo {
    pub fn missing() -> Self {
        Self { found: false, gcc: String::new(), version: String::new() }
    }
}

/// Extract a readable version from the first line of `--version` output.
/// Parenthesised text (toolchain banners, build labels) is dropped first, so
/// "arm-none-eabi-gcc (Arm GNU Toolchain 12.2.Rel1 (build ...)) 12.2.1 20221205"
/// yields "12.2.1". Falls back to the trimmed line when no x.y[.z] token exists.
/// True when a whitespace-delimited token looks like a version number:
/// two or three all-digit parts joined by dots ("12.2.1", "10.2"). A bare
/// date ("20221205") has one part and never matches; a date like "2022.05"
/// is the residual ambiguity this shape cannot distinguish — no known
/// arm-none-eabi banner emits one before the version, so the first match
/// wins and stays correct in practice.
fn version_token(token: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    (2..=3).contains(&parts.len())
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

pub fn parse_version(first_line: &str) -> String {
    let mut stripped = String::new();
    let mut depth = 0usize;
    for ch in first_line.chars() {
        match ch {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            c if depth == 0 => stripped.push(c),
            _ => {}
        }
    }
    for token in stripped.split_whitespace() {
        if version_token(token) {
            return token.to_string();
        }
    }
    let trimmed = first_line.trim();
    if trimmed.is_empty() { "unknown".to_string() } else { trimmed.to_string() }
}

fn probe(gcc: &Path) -> Option<ToolchainInfo> {
    let by_path = gcc.exists();
    let mut cmd = if by_path { Command::new(gcc) } else { Command::new(GCC_EXE) };
    let out = cmd.arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next().unwrap_or("");
    Some(ToolchainInfo {
        found: true,
        gcc: if by_path { gcc.display().to_string() } else { GCC_EXE.to_string() },
        version: parse_version(first),
    })
}

/// True for directory names that plausibly hold an arm-none-eabi install.
fn interesting_root(name: &str) -> bool {
    name.starts_with("arm gnu toolchain")
        || name.starts_with("xpack-arm-none-eabi-gcc")
        || name.starts_with("zephyr-sdk")
        || name == "sysgcc"
        || name.starts_with("gnu arm")
        || name.starts_with("arm")
}

/// Best-effort scan of common Windows install layouts for gcc binaries.
fn candidate_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let exe = format!("{GCC_EXE}.exe");
    for root in [r"C:\Program Files (x86)", r"C:\Program Files", "C:\\"] {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if !interesting_root(&name) {
                continue;
            }
            collect_gcc(&entry.path(), &exe, &mut out);
        }
    }
    // SysGCC-style flat layout: C:\SysGCC\arm-eabi\bin
    let flat = PathBuf::from(r"C:\SysGCC\arm-eabi\bin").join(&exe);
    if flat.exists() {
        out.push(flat);
    }
    out
}

/// Look for dir/bin/exe, then one or two directory levels down.
fn collect_gcc(dir: &Path, exe: &str, out: &mut Vec<PathBuf>) {
    let direct = dir.join("bin").join(exe);
    if direct.exists() {
        out.push(direct);
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let sub = entry.path();
        if !sub.is_dir() {
            continue;
        }
        let cand = sub.join("bin").join(exe);
        if cand.exists() {
            out.push(cand);
            continue;
        }
        let Ok(entries2) = std::fs::read_dir(&sub) else { continue };
        for e2 in entries2.flatten() {
            let p = e2.path().join("bin").join(exe);
            if p.exists() {
                out.push(p);
            }
        }
    }
}

pub fn detect() -> ToolchainInfo {
    if let Ok(p) = std::env::var(ENV_OVERRIDE) {
        if let Some(info) = probe(Path::new(&p)) {
            return info;
        }
    }
    if let Some(info) = probe(Path::new(GCC_EXE)) {
        return info;
    }
    for path in candidate_paths() {
        if let Some(info) = probe(&path) {
            return info;
        }
    }
    ToolchainInfo::missing()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_arm_release_version() {
        let line = "arm-none-eabi-gcc (Arm GNU Toolchain 12.2.Rel1 (build arm-12.2-Rel1-x86_64-mingw32)) 12.2.1 20221205";
        assert_eq!(parse_version(line), "12.2.1");
    }

    #[test]
    fn parses_plain_gcc_version() {
        assert_eq!(parse_version("arm-none-eabi-gcc (GCC) 10.3.1 20210621"), "10.3.1");
    }

    #[test]
    fn parses_two_component_version() {
        assert_eq!(parse_version("arm-none-eabi-gcc (xPack GNU Arm Embedded GCC 10.2.1) 10.2 2020"), "10.2");
    }

    #[test]
    fn falls_back_to_whole_line() {
        assert_eq!(parse_version("weird banner"), "weird banner");
        assert_eq!(parse_version("   "), "unknown");
    }

    #[test]
    fn more_than_two_dots_is_not_a_version() {
        // Three dots exceeds the accepted shape, so nothing matches and the
        // whole line becomes the version string.
        assert_eq!(parse_version("arm-none-eabi-gcc 12.2.1.1"), "arm-none-eabi-gcc 12.2.1.1");
    }

    #[test]
    fn a_bare_date_token_is_never_taken_as_the_version() {
        assert_eq!(parse_version("arm-none-eabi-gcc 20221205"), "arm-none-eabi-gcc 20221205");
    }

    #[test]
    fn candidate_root_names() {
        // candidate_paths() lowercases directory names before this check.
        assert!(interesting_root("arm gnu toolchain 12.2.rel1"));
        assert!(interesting_root("arm-gnu-toolchain-12.2"));
        assert!(interesting_root("xpack-arm-none-eabi-gcc-12.2.1-1"));
        assert!(interesting_root("zephyr-sdk-0.16.1"));
        assert!(interesting_root("sysgcc"));
        assert!(interesting_root("gnu arm embedded"));
        assert!(!interesting_root("rust"));
        assert!(!interesting_root("java"));
        assert!(!interesting_root("python311"));
    }
}
