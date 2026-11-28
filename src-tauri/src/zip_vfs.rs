//! Random access into a ZIP without extracting it.
//!
//! OWNER: subagent-rust-data
//!
//! A deck can be hundreds of megabytes; extracting it to read one XML part would make
//! opening it feel slow and would double the disk cost. This reads the central
//! directory once and inflates individual entries on demand, so the cost of opening a
//! file does not grow with its size.

use std::path::{Path, PathBuf};

/// An open ZIP, addressed by entry name.
pub struct ZipVfs {
    path: PathBuf,
    entries: Vec<Entry>,
    size: u64,
}

struct Entry {
    name: String,
    method: u16,
    compressed_size: u64,
    uncompressed_size: u64,
    local_header_offset: u64,
}

impl ZipVfs {
    /// Open a ZIP and index its central directory.
    pub fn open(path: &Path) -> std::io::Result<Self> {
        todo!("subagent-rust-data")
    }

    /// Total file size on disk.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// How many entries the archive declares.
    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Every entry name.
    pub fn names(&self) -> Vec<String> {
        self.entries.iter().map(|e| e.name.clone()).collect()
    }

    /// Whether an entry exists.
    pub fn has(&self, name: &str) -> bool {
        self.find(name).is_some()
    }

    /// Raw bytes of one entry, inflated when needed.
    pub fn read(&self, name: &str) -> std::io::Result<Vec<u8>> {
        todo!("subagent-rust-data")
    }

    /// One entry decoded as UTF-8 text.
    pub fn read_text(&self, name: &str) -> std::io::Result<String> {
        let bytes = self.read(name)?;
        String::from_utf8(bytes).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    fn find(&self, name: &str) -> Option<&Entry> {
        let normalised = normalise_entry(name);
        self.entries.iter().find(|e| e.name == normalised)
    }
}

/// Normalise an entry name so lookups do not depend on leading slashes or case.
pub fn normalise_entry(name: &str) -> String {
    name.trim_start_matches('/').replace('\\', "/").to_lowercase()
}
