//! Random access into a ZIP without extracting it.
//!
//! OWNER: subagent-rust-data
//!
//! A deck can be hundreds of megabytes; extracting it to read one XML part would make
//! opening it feel slow and would double the disk cost. This reads the central
//! directory once and inflates individual entries on demand, so the cost of opening a
//! file does not grow with its size.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use flate2::read::DeflateDecoder;

/// End of central directory record.
const EOCD_SIG: u32 = 0x0605_4b50;
/// ZIP64 end of central directory record.
const ZIP64_EOCD_SIG: u32 = 0x0606_4b50;
/// ZIP64 end of central directory locator.
const ZIP64_LOCATOR_SIG: u32 = 0x0706_4b50;
/// Central directory file header.
const CEN_SIG: u32 = 0x0201_4b50;
/// Local file header.
const LOC_SIG: u32 = 0x0403_4b50;

/// Fixed sizes of the records read below.
const EOCD_LEN: usize = 22;
const LOCATOR_LEN: usize = 20;
const ZIP64_EOCD_LEN: usize = 56;
const CEN_LEN: usize = 46;
const LOC_LEN: usize = 30;

/// Longest comment that can trail an EOCD, so the tail scan stays bounded.
const MAX_COMMENT: u64 = 0xffff;
/// A presentation central directory is far below this; anything larger is not ours.
const MAX_CENTRAL_DIR: u64 = 16 * 1024 * 1024;
/// Upper bound on the capacity hint handed to the inflate buffer. The real size still
/// comes from the entry; this only stops a lying header from reserving gigabytes.
const INFLATE_HINT_CAP: u64 = 16 * 1024 * 1024;
/// The ZIP64 extra field identifier.
const ZIP64_EXTRA_ID: u16 = 0x0001;

/// An open ZIP, addressed by entry name.
pub struct ZipVfs {
    path: PathBuf,
    entries: Vec<Entry>,
    size: u64,
}

struct Entry {
    /// Normalised lookup key: forward slashes, no leading slash, lower case.
    key: String,
    /// The name exactly as the archive stores it, which is what names() reports.
    name: String,
    method: u16,
    compressed_size: u64,
    uncompressed_size: u64,
    local_header_offset: u64,
}

/// Where the central directory lives, once the tail has been read.
struct Directory {
    total_entries: u64,
    offset: u64,
    size: u64,
}

impl ZipVfs {
    /// Open a ZIP and index its central directory.
    pub fn open(path: &Path) -> std::io::Result<Self> {
        let mut file = File::open(path)?;
        let size = file.metadata()?.len();
        let directory = find_central_directory(&mut file, size)?;
        // The cap applied in find_central_directory bounds this allocation.
        let bytes = read_at(&mut file, directory.offset, directory.size as usize)?;
        let entries = parse_central_directory(&bytes, directory.total_entries)?;
        Ok(Self {
            path: path.to_path_buf(),
            entries,
            size,
        })
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
        let entry = self.find(name).ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("no zip entry named {name}"),
            )
        })?;

        // The handle is opened per read rather than held: on Windows an open handle
        // keeps the deck locked, and a part is only read while a slide is drawn.
        let mut file = File::open(&self.path)?;

        // The local header own name and extra lengths are what actually place the
        // payload. They are allowed to differ from the central directory copy, which
        // is why the central lengths are not reused here.
        let header = read_at(&mut file, entry.local_header_offset, LOC_LEN)?;
        if header.len() < LOC_LEN {
            return Err(invalid("local file header is truncated"));
        }
        if u32_at(&header, 0) != Some(LOC_SIG) {
            return Err(invalid("local file header has the wrong signature"));
        }
        let name_len = u16_at(&header, 26).unwrap_or(0) as u64;
        let extra_len = u16_at(&header, 28).unwrap_or(0) as u64;
        let start = entry.local_header_offset + LOC_LEN as u64 + name_len + extra_len;

        // A zero compressed size is what an archive that defers its sizes to a data
        // descriptor reports; the uncompressed size is then the better guide.
        let length = if entry.compressed_size > 0 {
            entry.compressed_size
        } else {
            entry.uncompressed_size
        };
        if start.saturating_add(length) > self.size {
            return Err(invalid("zip entry extends past the end of the file"));
        }

        let raw = read_at(&mut file, start, length as usize)?;

        match entry.method {
            // Stored.
            0 => Ok(raw),
            // Deflated, a raw stream with no zlib wrapper.
            8 => {
                let hint = entry.uncompressed_size.min(INFLATE_HINT_CAP) as usize;
                let mut out = Vec::with_capacity(hint);
                DeflateDecoder::new(raw.as_slice()).read_to_end(&mut out)?;
                Ok(out)
            }
            other => Err(invalid(format!(
                "unsupported zip compression method {other}"
            ))),
        }
    }

    /// One entry decoded as UTF-8 text.
    pub fn read_text(&self, name: &str) -> std::io::Result<String> {
        let bytes = self.read(name)?;
        String::from_utf8(bytes).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    fn find(&self, name: &str) -> Option<&Entry> {
        let normalised = normalise_entry(name);
        self.entries.iter().find(|e| e.key == normalised)
    }
}

/// Normalise an entry name so lookups do not depend on leading slashes or case.
pub fn normalise_entry(name: &str) -> String {
    // Separators are converted before trimming. Trimming first left a leading
    // backslash in place, so the trim did nothing for exactly the inputs it exists to
    // handle, and a Windows-style name never matched.
    name.replace('\\', "/")
        .trim_start_matches('/')
        .to_lowercase()
}

fn invalid(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into())
}

/// Read up to `len` bytes at `offset`, returning fewer only at end of file.
fn read_at(file: &mut File, offset: u64, len: usize) -> std::io::Result<Vec<u8>> {
    if len == 0 {
        return Ok(Vec::new());
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0u8; len];
    let mut read = 0;
    while read < len {
        let n = file.read(&mut buf[read..])?;
        if n == 0 {
            break;
        }
        read += n;
    }
    buf.truncate(read);
    Ok(buf)
}

fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    let bytes = data.get(at..at + 2)?;
    Some(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    let bytes = data.get(at..at + 4)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn u64_at(data: &[u8], at: usize) -> Option<u64> {
    let bytes = data.get(at..at + 8)?;
    let mut buf = [0u8; 8];
    buf.copy_from_slice(bytes);
    Some(u64::from_le_bytes(buf))
}

/// Locate the central directory from the tail of the file.
///
/// Only the tail is read, so opening a 200 MB deck costs a few kilobytes of IO.
fn find_central_directory(file: &mut File, size: u64) -> std::io::Result<Directory> {
    let tail_len = size.min(MAX_COMMENT + EOCD_LEN as u64) as usize;
    if tail_len < EOCD_LEN {
        return Err(invalid("file is too small to be a zip archive"));
    }
    let tail_start = size - tail_len as u64;
    let tail = read_at(file, tail_start, tail_len)?;
    if tail.len() < EOCD_LEN {
        return Err(invalid("file is too small to be a zip archive"));
    }

    let mut found = None;
    for at in (0..=tail.len() - EOCD_LEN).rev() {
        if u32_at(&tail, at) == Some(EOCD_SIG) {
            found = Some(at);
            break;
        }
    }
    let at = found.ok_or_else(|| invalid("no end of central directory record"))?;

    let mut total_entries = u16_at(&tail, at + 10).unwrap_or(0) as u64;
    let mut cd_size = u32_at(&tail, at + 12).unwrap_or(0) as u64;
    let mut cd_offset = u32_at(&tail, at + 16).unwrap_or(0) as u64;

    // A saturated field is how the classic record says "see the ZIP64 record", which
    // is how decks over 4 GB and archives over 65535 entries are described.
    let saturated = total_entries == u16::MAX as u64
        || cd_size == u32::MAX as u64
        || cd_offset == u32::MAX as u64;
    if saturated {
        let eocd_at = tail_start + at as u64;
        if let Some(zip64) = read_zip64_directory(file, eocd_at, size)? {
            total_entries = zip64.total_entries;
            cd_size = zip64.size;
            cd_offset = zip64.offset;
        }
    }

    if cd_offset >= size {
        return Err(invalid("central directory starts past the end of the file"));
    }
    if cd_size == 0 || cd_size > MAX_CENTRAL_DIR {
        return Err(invalid("central directory is implausibly large"));
    }
    Ok(Directory {
        total_entries,
        offset: cd_offset,
        size: cd_size,
    })
}

/// Follow the ZIP64 locator, when there is one, to the 64-bit directory record.
fn read_zip64_directory(
    file: &mut File,
    eocd_at: u64,
    size: u64,
) -> std::io::Result<Option<Directory>> {
    if eocd_at < LOCATOR_LEN as u64 {
        return Ok(None);
    }
    let locator = read_at(file, eocd_at - LOCATOR_LEN as u64, LOCATOR_LEN)?;
    if u32_at(&locator, 0) != Some(ZIP64_LOCATOR_SIG) {
        return Ok(None);
    }
    let record_at = match u64_at(&locator, 8) {
        Some(at) if at < size => at,
        _ => return Ok(None),
    };
    let record = read_at(file, record_at, ZIP64_EOCD_LEN)?;
    if record.len() < ZIP64_EOCD_LEN || u32_at(&record, 0) != Some(ZIP64_EOCD_SIG) {
        return Ok(None);
    }
    Ok(Some(Directory {
        total_entries: u64_at(&record, 32).unwrap_or(0),
        size: u64_at(&record, 40).unwrap_or(0),
        offset: u64_at(&record, 48).unwrap_or(0),
    }))
}

/// Walk the central directory, collecting one entry per distinct name.
fn parse_central_directory(dir: &[u8], total_entries: u64) -> std::io::Result<Vec<Entry>> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut at = 0usize;

    while at + CEN_LEN <= dir.len() {
        if u32_at(dir, at) != Some(CEN_SIG) {
            break;
        }

        let flags = u16_at(dir, at + 8).unwrap_or(0);
        let method = u16_at(dir, at + 10).unwrap_or(0);
        let compressed = u32_at(dir, at + 20).unwrap_or(0);
        let uncompressed = u32_at(dir, at + 24).unwrap_or(0);
        let name_len = u16_at(dir, at + 28).unwrap_or(0) as usize;
        let extra_len = u16_at(dir, at + 30).unwrap_or(0) as usize;
        let comment_len = u16_at(dir, at + 32).unwrap_or(0) as usize;
        let offset = u32_at(dir, at + 42).unwrap_or(0);

        let name_start = at + CEN_LEN;
        let name_end = name_start + name_len;
        let extra_end = name_end + extra_len;
        let Some(name_bytes) = dir.get(name_start..name_end) else {
            break;
        };
        let stored_name = decode_name(name_bytes, flags);
        let key = normalise_entry(&stored_name);

        let mut compressed_size = compressed as u64;
        let mut uncompressed_size = uncompressed as u64;
        let mut local_header_offset = offset as u64;

        if let Some(extra) = dir.get(name_end..extra_end) {
            let overrides = zip64_extra(
                extra,
                uncompressed == u32::MAX,
                compressed == u32::MAX,
                offset == u32::MAX,
            );
            if let Some(value) = overrides.0 {
                uncompressed_size = value;
            }
            if let Some(value) = overrides.1 {
                compressed_size = value;
            }
            if let Some(value) = overrides.2 {
                local_header_offset = value;
            }
        }

        // Names are unique in a well-formed archive; when a broken one repeats a
        // name the first entry wins, which matches how a reader walks the archive.
        if seen.insert(key.clone()) {
            entries.push(Entry {
                key,
                name: stored_name,
                method,
                compressed_size,
                uncompressed_size,
                local_header_offset,
            });
        }

        at = extra_end + comment_len;
        if total_entries > 0 && entries.len() as u64 >= total_entries {
            break;
        }
    }

    if entries.is_empty() {
        return Err(invalid("zip archive has no readable entries"));
    }
    Ok(entries)
}

/// Decode an entry name. Bit 11 of the flags says it is UTF-8; otherwise it is a
/// legacy code page, which for OOXML is still plain ASCII in practice.
fn decode_name(bytes: &[u8], flags: u16) -> String {
    if flags & 0x0800 != 0 {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|b| *b as char).collect(),
    }
}

/// Read the 64-bit sizes a ZIP64 extra field carries.
///
/// The values appear in a fixed order, but only for the fields the central directory
/// could not represent, so which ones to read depends on which were saturated.
fn zip64_extra(
    extra: &[u8],
    need_uncompressed: bool,
    need_compressed: bool,
    need_offset: bool,
) -> (Option<u64>, Option<u64>, Option<u64>) {
    let Some(mut data) = extra_field(extra, ZIP64_EXTRA_ID) else {
        return (None, None, None);
    };
    let uncompressed = if need_uncompressed {
        take_u64(&mut data)
    } else {
        None
    };
    let compressed = if need_compressed {
        take_u64(&mut data)
    } else {
        None
    };
    let offset = if need_offset {
        take_u64(&mut data)
    } else {
        None
    };
    (uncompressed, compressed, offset)
}

/// Find one extra field by its identifier.
fn extra_field(extra: &[u8], id: u16) -> Option<&[u8]> {
    let mut at = 0usize;
    while at + 4 <= extra.len() {
        let field_id = u16_at(extra, at)?;
        let len = u16_at(extra, at + 2)? as usize;
        let start = at + 4;
        let end = start + len;
        if field_id == id {
            return extra.get(start..end);
        }
        at = end;
    }
    None
}

fn take_u64(data: &mut &[u8]) -> Option<u64> {
    if data.len() < 8 {
        return None;
    }
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&data[..8]);
    *data = &data[8..];
    Some(u64::from_le_bytes(buf))
}

/// A minimal ZIP writer, for tests only.
///
/// Building archives by hand keeps the tests honest: they exercise the reader against
/// bytes rather than against a library that might agree with its own mistakes.
#[cfg(test)]
pub(crate) mod test_zip {
    pub(crate) struct Fixture {
        pub name: String,
        pub data: Vec<u8>,
        pub deflate: bool,
    }

    impl Fixture {
        pub(crate) fn stored(name: &str, data: &[u8]) -> Self {
            Self {
                name: name.to_string(),
                data: data.to_vec(),
                deflate: false,
            }
        }

        pub(crate) fn deflated(name: &str, data: &[u8]) -> Self {
            Self {
                name: name.to_string(),
                data: data.to_vec(),
                deflate: true,
            }
        }
    }

    fn deflate(data: &[u8]) -> Vec<u8> {
        use flate2::write::DeflateEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).expect("deflate");
        encoder.finish().expect("deflate")
    }

    fn push_u16(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u32(out: &mut Vec<u8>, value: u32) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u64(out: &mut Vec<u8>, value: u64) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    /// The archive body and its central directory, before any trailer is written.
    pub(crate) struct Body {
        pub bytes: Vec<u8>,
        pub cd_offset: u64,
        pub cd_size: u64,
        pub count: usize,
    }

    fn body(entries: &[Fixture]) -> Body {
        let mut bytes = Vec::new();
        let mut central = Vec::new();

        for entry in entries {
            let name = entry.name.as_bytes();
            let payload = if entry.deflate {
                deflate(&entry.data)
            } else {
                entry.data.clone()
            };
            let method: u16 = if entry.deflate { 8 } else { 0 };
            let offset = bytes.len() as u32;

            // Local file header.
            push_u32(&mut bytes, 0x0403_4b50);
            push_u16(&mut bytes, 20);
            push_u16(&mut bytes, 0x0800);
            push_u16(&mut bytes, method);
            push_u16(&mut bytes, 0);
            push_u16(&mut bytes, 0);
            push_u32(&mut bytes, 0);
            push_u32(&mut bytes, payload.len() as u32);
            push_u32(&mut bytes, entry.data.len() as u32);
            push_u16(&mut bytes, name.len() as u16);
            push_u16(&mut bytes, 0);
            bytes.extend_from_slice(name);
            bytes.extend_from_slice(&payload);

            // Central directory file header.
            push_u32(&mut central, 0x0201_4b50);
            push_u16(&mut central, 20);
            push_u16(&mut central, 20);
            push_u16(&mut central, 0x0800);
            push_u16(&mut central, method);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, 0);
            push_u32(&mut central, payload.len() as u32);
            push_u32(&mut central, entry.data.len() as u32);
            push_u16(&mut central, name.len() as u16);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, 0);
            push_u32(&mut central, offset);
            central.extend_from_slice(name);
        }

        let cd_offset = bytes.len() as u64;
        let cd_size = central.len() as u64;
        bytes.extend_from_slice(&central);

        Body {
            bytes,
            cd_offset,
            cd_size,
            count: entries.len(),
        }
    }

    /// A classic archive: one local header and one central entry per fixture.
    pub(crate) fn build(entries: &[Fixture]) -> Vec<u8> {
        let Body {
            mut bytes,
            cd_offset,
            cd_size,
            count,
        } = body(entries);
        push_u32(&mut bytes, 0x0605_4b50);
        push_u16(&mut bytes, 0);
        push_u16(&mut bytes, 0);
        push_u16(&mut bytes, count as u16);
        push_u16(&mut bytes, count as u16);
        push_u32(&mut bytes, cd_size as u32);
        push_u32(&mut bytes, cd_offset as u32);
        push_u16(&mut bytes, 0);
        bytes
    }

    /// The same archive described the ZIP64 way: a saturated classic record, a
    /// locator, and a 64-bit record carrying the real numbers.
    pub(crate) fn build_zip64(entries: &[Fixture]) -> Vec<u8> {
        let Body {
            mut bytes,
            cd_offset,
            cd_size,
            count,
        } = body(entries);

        let record_at = bytes.len() as u64;
        push_u32(&mut bytes, 0x0606_4b50);
        push_u64(&mut bytes, 44);
        push_u16(&mut bytes, 45);
        push_u16(&mut bytes, 45);
        push_u32(&mut bytes, 0);
        push_u32(&mut bytes, 0);
        push_u64(&mut bytes, count as u64);
        push_u64(&mut bytes, count as u64);
        push_u64(&mut bytes, cd_size);
        push_u64(&mut bytes, cd_offset);

        push_u32(&mut bytes, 0x0706_4b50);
        push_u32(&mut bytes, 0);
        push_u64(&mut bytes, record_at);
        push_u32(&mut bytes, 1);

        push_u32(&mut bytes, 0x0605_4b50);
        push_u16(&mut bytes, 0);
        push_u16(&mut bytes, 0);
        push_u16(&mut bytes, u16::MAX);
        push_u16(&mut bytes, u16::MAX);
        push_u32(&mut bytes, u32::MAX);
        push_u32(&mut bytes, u32::MAX);
        push_u16(&mut bytes, 0);
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::test_zip::{build, build_zip64, Fixture};
    use super::*;

    fn write(name: &str, bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn reads_a_stored_entry() {
        let (_d, path) = write(
            "deck.pptx",
            &build(&[Fixture::stored("ppt/presentation.xml", b"<p:presentation/>")]),
        );
        let vfs = ZipVfs::open(&path).unwrap();
        assert_eq!(vfs.entry_count(), 1);
        assert_eq!(
            vfs.read_text("ppt/presentation.xml").unwrap(),
            "<p:presentation/>"
        );
    }

    #[test]
    fn reads_a_deflated_entry() {
        let text = "<p:sldSz cx=\"12192000\" cy=\"6858000\"/>".repeat(20).into_bytes();
        let (_d, path) = write(
            "deck.pptx",
            &build(&[
                Fixture::deflated("ppt/slides/slide1.xml", &text),
                Fixture::stored("ppt/presentation.xml", b"<p:presentation/>"),
            ]),
        );
        let vfs = ZipVfs::open(&path).unwrap();
        assert_eq!(vfs.read("ppt/slides/slide1.xml").unwrap(), text);
        // The other entry is still readable, so one inflate does not disturb the next.
        assert_eq!(
            vfs.read_text("ppt/presentation.xml").unwrap(),
            "<p:presentation/>"
        );
    }

    #[test]
    fn a_missing_entry_is_an_error() {
        let (_d, path) = write("deck.pptx", &build(&[Fixture::stored("a.xml", b"x")]));
        let vfs = ZipVfs::open(&path).unwrap();
        let err = vfs.read("ppt/slides/slide9.xml").unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        assert!(!vfs.has("ppt/slides/slide9.xml"));
        assert!(vfs.has("a.xml"));
    }

    #[test]
    fn normalise_entry_handles_leading_slash_and_backslash() {
        assert_eq!(
            normalise_entry("/ppt/slides/slide1.xml"),
            "ppt/slides/slide1.xml"
        );
        assert_eq!(
            normalise_entry("\\ppt\\slides\\slide1.xml"),
            "ppt/slides/slide1.xml"
        );
        assert_eq!(
            normalise_entry("PPT/Slides/Slide1.XML"),
            "ppt/slides/slide1.xml"
        );
        assert_eq!(normalise_entry("///a.xml"), "a.xml");
    }

    #[test]
    fn lookups_ignore_case_and_separators() {
        let (_d, path) = write(
            "deck.pptx",
            &build(&[Fixture::stored("ppt/slides/slide1.xml", b"one")]),
        );
        let vfs = ZipVfs::open(&path).unwrap();
        assert!(vfs.has("/PPT/Slides/Slide1.xml"));
        assert_eq!(vfs.read("\\ppt\\slides\\slide1.xml").unwrap(), b"one".to_vec());
        assert_eq!(vfs.names(), vec!["ppt/slides/slide1.xml".to_string()]);
    }

    #[test]
    fn reads_a_zip64_archive() {
        // The classic record saturates every count and offset, so the real numbers can
        // only come from the ZIP64 record behind the locator.
        let (_d, path) = write(
            "big.pptx",
            &build_zip64(&[
                Fixture::stored("ppt/presentation.xml", b"<p:presentation/>"),
                Fixture::deflated("ppt/slides/slide1.xml", b"<p:sld/>"),
            ]),
        );
        let vfs = ZipVfs::open(&path).unwrap();
        assert_eq!(vfs.entry_count(), 2);
        assert_eq!(
            vfs.read_text("ppt/presentation.xml").unwrap(),
            "<p:presentation/>"
        );
        assert_eq!(vfs.read_text("ppt/slides/slide1.xml").unwrap(), "<p:sld/>");
    }

    #[test]
    fn a_directory_larger_than_the_cap_is_rejected() {
        let mut bytes = build(&[Fixture::stored("a.xml", b"x")]);
        // Claim a directory far larger than the cap, with no ZIP64 locator to explain
        // it, which is what a malicious archive would try.
        let eocd = bytes.len() - 22;
        bytes[eocd + 12..eocd + 16].copy_from_slice(&u32::MAX.to_le_bytes());
        let (_d, path) = write("broken.pptx", &bytes);
        assert!(ZipVfs::open(&path).is_err());
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_rejected() {
        let (_d, path) = write("deck.pptx", b"this is not a zip archive at all");
        assert!(ZipVfs::open(&path).is_err());
    }

    #[test]
    fn a_truncated_archive_is_rejected() {
        let full = build(&[Fixture::stored("a.xml", b"x")]);
        let (_d, path) = write("cut.pptx", &full[..full.len() / 2]);
        assert!(ZipVfs::open(&path).is_err());
    }

    #[test]
    fn reports_the_file_size() {
        let bytes = build(&[Fixture::stored("a.xml", b"x")]);
        let (_d, path) = write("deck.pptx", &bytes);
        let vfs = ZipVfs::open(&path).unwrap();
        assert_eq!(vfs.size(), bytes.len() as u64);
    }

    #[test]
    fn local_header_lengths_take_precedence() {
        // A local extra field the central directory does not know about shifts the
        // payload; using the central lengths here would read the wrong bytes.
        let mut bytes = Vec::new();
        let name = b"a.xml";
        let data = b"payload";
        let extra = b"\x99\x99\x02\x00ab";

        bytes.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        bytes.extend_from_slice(&20u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes()); // stored
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&(name.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&(extra.len() as u16).to_le_bytes());
        bytes.extend_from_slice(name);
        bytes.extend_from_slice(extra);
        bytes.extend_from_slice(data);

        let cd_offset = bytes.len() as u32;
        let mut central = Vec::new();
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes()); // no central extra
        central.extend_from_slice(&0u16.to_le_bytes()); // no comment
        central.extend_from_slice(&0u16.to_le_bytes()); // disk start
        central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        central.extend_from_slice(&0u32.to_le_bytes()); // local header at 0
        central.extend_from_slice(name);
        let cd_size = central.len() as u32;
        bytes.extend_from_slice(&central);

        bytes.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&cd_size.to_le_bytes());
        bytes.extend_from_slice(&cd_offset.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());

        let (_d, path) = write("shifted.pptx", &bytes);
        let vfs = ZipVfs::open(&path).unwrap();
        assert_eq!(vfs.read("a.xml").unwrap(), b"payload".to_vec());
    }
}
