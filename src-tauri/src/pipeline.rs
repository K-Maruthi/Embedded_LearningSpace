//! Runs the Compilation Path lab example through a real arm-none-eabi
//! toolchain in a throwaway temp directory and returns per-stage evidence.
//! The lab bench may override the three fixed source slots; filenames, flags
//! and output paths stay fixed no matter what the user writes.

use crate::toolchain::ToolchainInfo;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAIN_C: &str = include_str!("examples/main.c");
pub const STARTUP_S: &str = include_str!("examples/startup.s");
pub const LINKER_LD: &str = include_str!("examples/linker.ld");

/// One user-authored file for the lab bench. Only these three fixed slots are
/// ever written to disk with fixed names — no caller-supplied paths, names or
/// arguments. Size-capped to keep the temp workspace sane.
pub const SOURCE_LIMIT: usize = 200_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    pub main_c: Option<String>,
    pub startup_s: Option<String>,
    pub linker_ld: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcesBundle {
    pub main_c: String,
    pub startup_s: String,
    pub linker_ld: String,
}

pub fn default_sources() -> SourcesBundle {
    SourcesBundle {
        main_c: MAIN_C.to_string(),
        startup_s: STARTUP_S.to_string(),
        linker_ld: LINKER_LD.to_string(),
    }
}

/// Merge user edits over the defaults; empty/whitespace-only slots fall back.
pub fn resolve_sources(user: Option<Sources>) -> Result<SourcesBundle, String> {
    let mut d = default_sources();
    if let Some(u) = user {
        for (slot, name) in [(u.main_c, "mainC"), (u.startup_s, "startupS"), (u.linker_ld, "linkerLd")] {
            if let Some(text) = slot {
                if text.len() > SOURCE_LIMIT {
                    return Err(format!("{name} is too large (limit is {SOURCE_LIMIT} bytes)"));
                }
                if !text.trim().is_empty() {
                    match name {
                        "mainC" => d.main_c = text,
                        "startupS" => d.startup_s = text,
                        _ => d.linker_ld = text,
                    }
                }
            }
        }
    }
    Ok(d)
}

const COMMON_FLAGS: [&str; 6] = [
    "-mcpu=cortex-m4",
    "-mthumb",
    "-O1",
    "-ffreestanding",
    "-Wall",
    "-Wextra",
];

const ARTIFACT_LIMIT: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageOut {
    pub id: String,
    pub commands: Vec<String>,
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineReport {
    pub toolchain: String,
    pub ok: bool,
    /// True when at least one stage used user-edited sources.
    pub custom: bool,
    pub stages: Vec<StageOut>,
}

struct Runner {
    gcc: PathBuf,
    dir: PathBuf,
}

impl Runner {
    /// Resolve a sibling tool (objdump/size/objcopy) next to the gcc binary.
    fn tool(&self, name: &str) -> PathBuf {
        match self.gcc.parent() {
            Some(p) if !p.as_os_str().is_empty() => p.join(format!("{name}.exe")),
            _ => PathBuf::from(format!("{name}.exe")),
        }
    }

    fn cmd_display(program: &Path, args: &[&str]) -> String {
        let prog = program
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| program.display().to_string());
        let mut s = prog;
        for a in args {
            s.push(' ');
            s.push_str(a);
        }
        s
    }

    fn run(&self, program: &Path, args: &[&str]) -> (bool, String, String, String) {
        let mut c = Command::new(program);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        c.args(args).current_dir(&self.dir);
        let display = Self::cmd_display(program, args);
        match c.output() {
            Ok(out) => (
                out.status.success(),
                String::from_utf8_lossy(&out.stdout).into_owned(),
                String::from_utf8_lossy(&out.stderr).into_owned(),
                display,
            ),
            Err(e) => (false, String::new(), format!("failed to spawn: {e}"), display),
        }
    }
}

fn clip(s: &str) -> String {
    if s.chars().count() <= ARTIFACT_LIMIT {
        return s.to_string();
    }
    let kept: String = s.chars().take(ARTIFACT_LIMIT).collect();
    format!("{kept}\n... [truncated by the app — the full file is in the temp build dir] ...")
}

fn read_file(dir: &Path, name: &str) -> String {
    match std::fs::read(dir.join(name)) {
        Ok(bytes) => clip(&String::from_utf8_lossy(&bytes)),
        Err(e) => format!("<could not read {name}: {e}>"),
    }
}

fn hexdump(bytes: &[u8], limit: usize) -> String {
    let mut out = String::new();
    for (i, chunk) in bytes.chunks(16).enumerate() {
        if i >= limit {
            break;
        }
        out.push_str(&format!("{:08X}  ", (i * 16) as u64));
        for b in chunk {
            out.push_str(&format!("{b:02X} "));
        }
        for _ in chunk.len()..16 {
            out.push_str("   ");
        }
        out.push('|');
        let ascii: String = chunk
            .iter()
            .map(|b| if (0x20..0x7F).contains(b) { *b as char } else { '.' })
            .collect();
        out.push_str(&ascii);
        out.push('\n');
    }
    out
}

fn stage(id: &str) -> StageOut {
    StageOut {
        id: id.to_string(),
        commands: Vec::new(),
        ok: true,
        stdout: String::new(),
        stderr: String::new(),
        artifacts: Vec::new(),
    }
}

pub fn run_pipeline(info: &ToolchainInfo, src: &SourcesBundle, custom: bool) -> PipelineReport {
    let gcc = PathBuf::from(&info.gcc);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("ecroadmap-pipeline-{nanos}"));
    if std::fs::create_dir_all(&dir).is_err() {
        return PipelineReport {
            toolchain: format!("{} {}", info.gcc, info.version),
            ok: false,
            custom,
            stages: vec![],
        };
    }
    let r = Runner { gcc, dir: dir.clone() };
    let mut stages: Vec<StageOut> = Vec::new();

    // 1 · source — the exact files handed to the tools.
    {
        let mut s = stage("source");
        s.artifacts = vec![
            Artifact { name: "main.c".into(), text: clip(&src.main_c) },
            Artifact { name: "startup.s".into(), text: clip(&src.startup_s) },
            Artifact { name: "linker.ld".into(), text: clip(&src.linker_ld) },
        ];
        stages.push(s);
    }
    let _ = std::fs::write(dir.join("main.c"), &src.main_c);
    let _ = std::fs::write(dir.join("startup.s"), &src.startup_s);
    let _ = std::fs::write(dir.join("linker.ld"), &src.linker_ld);

    let mut failed = false;

    // 2 · preprocess
    if !failed {
        let mut s = stage("preprocess");
        let mut args: Vec<&str> = vec!["-E", "main.c", "-o", "main.i"];
        args.extend_from_slice(&COMMON_FLAGS);
        let (ok, so, se, cmd) = r.run(&r.gcc, &args);
        s.commands.push(cmd);
        s.ok = ok;
        s.stdout = clip(&so);
        s.stderr = clip(&se);
        if ok {
            let marker = if src.main_c.contains("add_limit") { "add_limit" } else { "int main" };
            s.artifacts
                .push(Artifact { name: "main.i (tail — the part this example cares about)".into(), text: tail_from(&read_file(&dir, "main.i"), marker) });
        }
        failed = !ok;
        stages.push(s);
    }

    // 3 · compile
    if !failed {
        let mut s = stage("compile");
        let mut args: Vec<&str> = vec!["-S", "main.i", "-o", "main.s"];
        args.extend_from_slice(&COMMON_FLAGS);
        let (ok, so, se, cmd) = r.run(&r.gcc, &args);
        s.commands.push(cmd);
        s.ok = ok;
        s.stdout = clip(&so);
        s.stderr = clip(&se);
        if ok {
            s.artifacts.push(Artifact { name: "main.s".into(), text: read_file(&dir, "main.s") });
        }
        failed = !ok;
        stages.push(s);
    }

    // 4 · assemble both objects
    if !failed {
        let mut s = stage("assemble");
        for (src, obj) in [("main.s", "main.o"), ("startup.s", "startup.o")] {
            let mut args: Vec<&str> = vec!["-c", src, "-o", obj];
            args.extend_from_slice(&COMMON_FLAGS);
            let (ok, so, se, cmd) = r.run(&r.gcc, &args);
            s.commands.push(cmd);
            s.stdout.push_str(&so);
            s.stderr.push_str(&se);
            s.ok = s.ok && ok;
        }
        failed = !s.ok;
        stages.push(s);
    }

    // 5 · object — inspect the relocatable file
    if !failed {
        let mut s = stage("object");
        let objdump = r.tool("arm-none-eabi-objdump");
        for (flag, file) in [("-h", "main.o"), ("-t", "main.o"), ("-h", "startup.o")] {
            let (ok, so, se, cmd) = r.run(&objdump, &[flag, file]);
            s.stdout.push_str(&format!("$ {cmd}\n{so}"));
            s.commands.push(cmd);
            s.stderr.push_str(&se);
            s.ok = s.ok && ok;
        }
        s.stdout = clip(&s.stdout);
        failed = !s.ok;
        stages.push(s);
    }

    // 6 · link
    if !failed {
        let mut s = stage("link");
        let (ok, so, se, cmd) = r.run(
            &r.gcc,
            &[
                "main.o",
                "startup.o",
                "-T",
                "linker.ld",
                "-nostartfiles",
                "-nostdlib",
                "-Wl,-Map=firmware.map",
                "-o",
                "firmware.elf",
            ],
        );
        s.commands.push(cmd);
        s.stdout = so;
        s.stderr = se;
        s.ok = ok;
        if ok {
            let size = r.tool("arm-none-eabi-size");
            let (ok2, so2, se2, cmd2) = r.run(&size, &["firmware.elf"]);
            s.commands.push(cmd2.clone());
            if so2.is_empty() {
                s.stdout.push_str(&se2);
            } else {
                s.stdout.push_str(&format!("$ {cmd2}\n{so2}"));
            }
            s.ok = ok2;
            let objdump = r.tool("arm-none-eabi-objdump");
            let (ok3, so3, _se3, cmd3) = r.run(&objdump, &["-h", "firmware.elf"]);
            s.commands.push(cmd3.clone());
            s.stdout.push_str(&format!("\n$ {cmd3}\n{}", clip(&so3)));
            s.ok = s.ok && ok3;
            s.artifacts
                .push(Artifact { name: "firmware.map (excerpt)".into(), text: map_excerpt(&read_file(&dir, "firmware.map")) });
        }
        failed = !s.ok;
        stages.push(s);
    }

    // 7 · image
    if !failed {
        let mut s = stage("image");
        let objcopy = r.tool("arm-none-eabi-objcopy");
        let (ok, so, se, cmd) = r.run(&objcopy, &["-O", "binary", "firmware.elf", "firmware.bin"]);
        s.commands.push(cmd);
        s.stdout = so;
        s.stderr = se;
        s.ok = ok;
        if ok {
            match std::fs::read(dir.join("firmware.bin")) {
                Ok(bytes) => {
                    let n = bytes.len();
                    s.stdout.push_str(&format!(
                        "firmware.bin is {n} bytes — the flat load image derived from firmware.elf.\n\n\
                         First bytes (little-endian words: initial SP, then Reset_Handler address):\n"
                    ));
                    s.stdout.push_str(&hexdump(&bytes, 4));
                }
                Err(e) => {
                    s.ok = false;
                    s.stderr.push_str(&format!("could not read firmware.bin: {e}"));
                }
            }
        }
        stages.push(s);
    }

    let _ = std::fs::remove_dir_all(&dir);
    let ok = stages.iter().all(|s| s.ok);
    PipelineReport {
        toolchain: format!("{} ({})", info.gcc, info.version),
        ok,
        custom,
        stages,
    }
}

/// Keep the preprocessed output from the first occurrence of the marker on.
fn tail_from(text: &str, marker: &str) -> String {
    match text.find(marker) {
        Some(idx) => {
            let start = text[..idx].rfind('\n').map(|i| i + 1).unwrap_or(idx);
            clip(&text[start..])
        }
        None => clip(text),
    }
}

/// Keep the section-placement and global-symbol parts of the map file.
fn map_excerpt(map: &str) -> String {
    let mut out = String::new();
    let mut in_sections = false;
    for line in map.lines() {
        if line.starts_with("Memory Configuration") {
            in_sections = true;
        }
        if in_sections {
            out.push_str(line);
            out.push('\n');
        }
        if out.chars().count() > ARTIFACT_LIMIT / 2 {
            break;
        }
    }
    if out.is_empty() {
        clip(map)
    } else {
        clip(&out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hexdump_formats_bytes() {
        let d = hexdump(&[0x00, 0x00, 0x02, 0x20], 4);
        assert!(d.starts_with("00000000  00 00 02 20"));
        assert!(d.contains("|... "));
    }

    #[test]
    fn tail_from_finds_marker() {
        let t = tail_from("line1\nline2\nadd_limit(x) { }", "add_limit");
        assert!(t.starts_with("add_limit"));
    }

    #[test]
    fn resolve_falls_back_for_empty_and_caps_oversize() {
        let merged = resolve_sources(Some(Sources {
            main_c: Some("   ".into()),
            startup_s: Some("custom".into()),
            linker_ld: None,
        }))
        .unwrap();
        assert_eq!(merged.main_c, MAIN_C);
        assert_eq!(merged.startup_s, "custom");
        assert_eq!(merged.linker_ld, LINKER_LD);
        let big = "x".repeat(SOURCE_LIMIT + 1);
        assert!(resolve_sources(Some(Sources {
            main_c: Some(big),
            startup_s: None,
            linker_ld: None,
        }))
        .is_err());
    }

    /// Needs a real arm-none-eabi toolchain on this machine; run with
    /// `cargo test -- --ignored` after installing one.
    #[test]
    #[ignore]
    fn full_pipeline_against_real_toolchain() {
        let info = crate::toolchain::detect();
        assert!(info.found, "no arm-none-eabi-gcc detected");
        let src = default_sources();
        let report = run_pipeline(&info, &src, false);
        for s in &report.stages {
            assert!(s.ok, "stage {} failed:\n{}", s.id, s.stderr);
        }
        assert!(report.ok);
    }
}
