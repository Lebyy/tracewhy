use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::Path;

pub fn private_file_options() -> OpenOptions {
    let options = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = options;
        options.mode(0o600);
        options
    }
    #[cfg(not(unix))]
    options
}

pub fn create_private_directory(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

pub fn create_new_private_file(path: &Path) -> io::Result<File> {
    private_file_options()
        .write(true)
        .create_new(true)
        .open(path)
}

pub fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    // Windows rename does not replace an existing destination as POSIX rename does.
    #[cfg(windows)]
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::rename(source, destination)
}
