//! Reads the scripts named on the command line

use crate::lint::Input;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The path that reads a script from stdin
pub const STDIN: &str = "-";

/// Catalog files that sessions keep next to their scripts, they describe the connection and are not meant to run.
/// `dashql-functions.sql` and `dashql-relations.sql` are their names in older versions.
const GENERATED_FILES: [&str; 5] = [
    "dashql-catalog-changes.sql",
    "dashql-catalog-functions.sql",
    "dashql-catalog-relations.sql",
    "dashql-functions.sql",
    "dashql-relations.sql",
];

/// The directory the user invoked the CLI from. Under `bazel run` the process runs in the runfiles tree.
pub fn working_directory() -> std::io::Result<PathBuf> {
    match std::env::var_os("BUILD_WORKING_DIRECTORY") {
        Some(dir) => Ok(dir.into()),
        None => std::env::current_dir(),
    }
}

/// Remove `.` and `..` components without touching the file system
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            c => out.push(c),
        }
    }
    out
}

/// Paths relative to the invoking directory, absolute ones for files outside of it
fn display_path(path: &Path, cwd: &Path) -> String {
    match path.strip_prefix(cwd) {
        Ok(rel) if !rel.as_os_str().is_empty() => rel.display().to_string(),
        _ => path.display().to_string(),
    }
}

/// The *.sql files under a directory, in file name order
fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    walk_below(dir, &mut Vec::new(), out)
}

/// Walk a directory that `parents`, the real paths of the directories being walked, may already contain.
/// A link back to one of them would repeat the scripts on every level, and with two such links never end.
fn walk_below(dir: &Path, parents: &mut Vec<PathBuf>, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let real = std::fs::canonicalize(dir)?;
    if parents.contains(&real) {
        return Ok(());
    }
    parents.push(real);
    let mut entries = std::fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Follow symlinks, SQL libraries are often linked into place
        let Ok(info) = std::fs::metadata(&path) else { continue };
        if info.is_dir() {
            if name != "node_modules" && !name.starts_with('.') {
                walk_below(&path, parents, out)?;
            }
        } else if info.is_file() && name.to_lowercase().ends_with(".sql") && !GENERATED_FILES.contains(&&*name) {
            out.push(path);
        }
    }
    parents.pop();
    Ok(())
}

fn with_path<T>(path: &Path, result: std::io::Result<T>) -> Result<T, String> {
    result.map_err(|e| format!("{}: {e}", path.display()))
}

/// Read SQL scripts from files, directories (recursively, *.sql only, without generated catalog files) and stdin
/// (`-`). Scripts are identified by their path relative to the invoking directory, each is read once.
pub fn read_inputs(paths: &[String], cwd: &Path, stdin: &mut dyn Read) -> Result<Vec<Input>, String> {
    let mut inputs = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        if path == STDIN {
            let mut bytes = Vec::new();
            stdin.read_to_end(&mut bytes).map_err(|e| format!("stdin: {e}"))?;
            if seen.insert("<stdin>".to_string()) {
                inputs.push(Input { id: "<stdin>".into(), text: String::from_utf8_lossy(&bytes).into_owned() });
            }
            continue;
        }
        let root = normalize(&cwd.join(path));
        let mut files = Vec::new();
        if with_path(&root, std::fs::metadata(&root))?.is_dir() {
            with_path(&root, walk(&root, &mut files))?;
        } else {
            files.push(root);
        }
        for file in files {
            let id = display_path(&file, cwd);
            if seen.insert(id.clone()) {
                let bytes = with_path(&file, std::fs::read(&file))?;
                inputs.push(Input { id, text: String::from_utf8_lossy(&bytes).into_owned() });
            }
        }
    }
    Ok(inputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::temp_dir;

    #[test]
    fn normalizes_paths_lexically() {
        assert_eq!(normalize(Path::new("/a/./b/../c.sql")), Path::new("/a/c.sql"));
        assert_eq!(display_path(Path::new("/a/b/c.sql"), Path::new("/a")), "b/c.sql");
        assert_eq!(display_path(Path::new("/x/c.sql"), Path::new("/a")), "/x/c.sql");
        assert_eq!(display_path(Path::new("/a"), Path::new("/a")), "/a");
    }

    #[test]
    fn walks_sql_files_in_name_order() {
        let root = PathBuf::from(std::env::var_os("TEST_TMPDIR").unwrap_or_else(|| std::env::temp_dir().into()))
            .join("dashql_cli_walk");
        let _ = std::fs::remove_dir_all(&root);
        for file in [
            "b.sql",
            "a.SQL",
            "notes.txt",
            "dashql-relations.sql",
            "dashql-catalog-relations.sql",
            "dashql-catalog-changes.sql",
            "sub/c.sql",
            ".hidden/d.sql",
            "node_modules/e.sql",
        ] {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "select 1;").unwrap();
        }
        let mut files = Vec::new();
        walk(&root, &mut files).unwrap();
        let files: Vec<_> = files.iter().map(|f| display_path(f, &root)).collect();
        assert_eq!(files, ["a.SQL", "b.sql", "sub/c.sql"]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A directory with the given files, each file holds its own name
    fn files(names: &[&str]) -> PathBuf {
        let root = temp_dir("dashql-cli-inputs");
        for name in names {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, name).unwrap();
        }
        root
    }

    fn read(cwd: &Path, paths: &[&str], stdin: &[u8]) -> Result<Vec<Input>, String> {
        let paths: Vec<String> = paths.iter().map(|p| p.to_string()).collect();
        read_inputs(&paths, cwd, &mut &*stdin)
    }

    fn ids(inputs: &[Input]) -> Vec<&str> {
        inputs.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn names_scripts_relative_to_the_invoking_directory() {
        let root = files(&["work/a.sql", "work/sub/b.sql", "outside/c.sql"]);
        let cwd = root.join("work");
        let inputs = read(&cwd, &["a.sql", "./sub/b.sql", "../outside/c.sql"], b"").unwrap();
        let outside = root.join("outside/c.sql").display().to_string();
        assert_eq!(ids(&inputs), ["a.sql", "sub/b.sql", outside.as_str()]);
        assert_eq!(inputs[0].text, "work/a.sql");
        assert_eq!(inputs[1].text, "work/sub/b.sql");
    }

    #[test]
    fn reads_absolute_paths_and_names_them_relative_when_they_are_inside() {
        let root = files(&["a.sql"]);
        let absolute = root.join("a.sql").display().to_string();
        assert_eq!(ids(&read(&root, &[&absolute], b"").unwrap()), ["a.sql"]);
    }

    #[test]
    fn reads_every_script_once() {
        let root = files(&["a.sql", "sub/b.sql"]);
        let absolute = root.join("a.sql").display().to_string();
        let inputs = read(&root, &["a.sql", "./a.sql", &absolute, "sub/../a.sql", ".", "sub", "sub/b.sql"], b"").unwrap();
        assert_eq!(ids(&inputs), ["a.sql", "sub/b.sql"]);
    }

    #[test]
    fn keeps_the_order_of_the_arguments() {
        let root = files(&["a.sql", "b.sql", "sub/c.sql"]);
        assert_eq!(ids(&read(&root, &["sub", "b.sql", "a.sql"], b"").unwrap()), ["sub/c.sql", "b.sql", "a.sql"]);
    }

    #[test]
    fn reads_named_files_of_any_kind_but_filters_directories() {
        let root = files(&["notes.txt", "dashql-relations.sql", "a.sql"]);
        assert_eq!(ids(&read(&root, &["notes.txt", "dashql-relations.sql"], b"").unwrap()), ["notes.txt", "dashql-relations.sql"]);
        assert_eq!(ids(&read(&root, &["."], b"").unwrap()), ["a.sql"]);
    }

    #[test]
    fn finds_nothing_in_a_directory_without_scripts() {
        let root = files(&["notes.txt"]);
        assert_eq!(read(&root, &["."], b"").unwrap(), vec![]);
    }

    #[test]
    fn reads_stdin_once() {
        let root = files(&["a.sql"]);
        let inputs = read(&root, &["-", "a.sql", "-"], b"select 1;").unwrap();
        assert_eq!(ids(&inputs), ["<stdin>", "a.sql"]);
        assert_eq!(inputs[0].text, "select 1;");
    }

    #[test]
    fn replaces_invalid_utf8() {
        let root = files(&[]);
        std::fs::write(root.join("a.sql"), b"select '\xff';").unwrap();
        let inputs = read(&root, &["a.sql", "-"], b"select '\xfe';").unwrap();
        assert_eq!(inputs[0].text, "select '\u{fffd}';");
        assert_eq!(inputs[1].text, "select '\u{fffd}';");
    }

    #[test]
    fn fails_when_stdin_fails() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("closed"))
            }
        }
        let root = files(&[]);
        assert_eq!(read_inputs(&["-".to_string()], &root, &mut Broken), Err("stdin: closed".to_string()));
    }

    #[test]
    fn names_a_missing_path_in_the_error() {
        let root = files(&[]);
        let error = read(&root, &["missing.sql"], b"").unwrap_err();
        assert!(error.starts_with(&format!("{}: ", root.join("missing.sql").display())), "{error}");
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::fs::{symlink, PermissionsExt};

        #[test]
        fn follows_symlinks_to_directories_and_files() {
            let root = files(&["library/b.sql", "work/a.sql", "other.sql"]);
            symlink(root.join("library"), root.join("work/linked")).unwrap();
            symlink(root.join("other.sql"), root.join("work/other.sql")).unwrap();
            let inputs = read(&root.join("work"), &["."], b"").unwrap();
            assert_eq!(ids(&inputs), ["a.sql", "linked/b.sql", "other.sql"]);
        }

        #[test]
        fn skips_dangling_symlinks_in_a_directory() {
            let root = files(&["a.sql"]);
            symlink(root.join("gone.sql"), root.join("dangling.sql")).unwrap();
            assert_eq!(ids(&read(&root, &["."], b"").unwrap()), ["a.sql"]);
            assert!(read(&root, &["dangling.sql"], b"").is_err());
        }

        #[test]
        fn reads_a_directory_with_a_link_to_itself_once() {
            let root = files(&["a.sql"]);
            symlink(&root, root.join("loop")).unwrap();
            assert_eq!(ids(&read(&root, &["."], b"").unwrap()), ["a.sql"]);
        }

        #[test]
        fn survives_two_links_to_the_same_ancestor() {
            // Without a guard the walk doubles on every level until the kernel gives up after 40 links
            let root = files(&["a.sql", "sub/b.sql"]);
            symlink(&root, root.join("sub/up1")).unwrap();
            symlink(&root, root.join("sub/up2")).unwrap();
            assert_eq!(ids(&read(&root, &["."], b"").unwrap()), ["a.sql", "sub/b.sql"]);
        }

        #[test]
        fn walks_a_directory_that_two_links_share() {
            let root = files(&["library/b.sql", "work/x/keep", "work/y/keep"]);
            symlink(root.join("library"), root.join("work/x/lib")).unwrap();
            symlink(root.join("library"), root.join("work/y/lib")).unwrap();
            assert_eq!(ids(&read(&root.join("work"), &["."], b"").unwrap()), ["x/lib/b.sql", "y/lib/b.sql"]);
        }

        #[test]
        fn fails_on_files_and_directories_that_cannot_be_read() {
            // Root reads everything
            if unsafe { libc::geteuid() } == 0 {
                return;
            }
            let root = files(&["a.sql", "locked/b.sql"]);
            let set_mode = |path: &str, mode| std::fs::set_permissions(root.join(path), std::fs::Permissions::from_mode(mode)).unwrap();
            set_mode("a.sql", 0o000);
            let error = read(&root, &["a.sql"], b"").unwrap_err();
            assert!(error.starts_with(&format!("{}: ", root.join("a.sql").display())), "{error}");
            set_mode("a.sql", 0o644);
            set_mode("locked", 0o000);
            assert!(read(&root, &["."], b"").is_err());
            set_mode("locked", 0o755);
        }
    }
}
