//! Decide what a file is from its bytes, not its name.
//!
//! Extension is a hint a user can rename, so every decision here starts from the
//! container signature. A file whose bytes disagree with its extension is still
//! opened; the mismatch is reported instead of rejected.

use std::io::Read;
use std::path::Path;

use crate::types::{ContainerKind, DeckKind, FormatInfo};

/// How many leading bytes are needed to recognise a container.
const SNIFF_LEN: usize = 4096;

/// A ZIP local file header, or a spanned/split marker.
fn looks_like_zip(head: &[u8]) -> bool {
    head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") || head.starts_with(b"PK\x07\x08")
}

/// A compound file, which is what a legacy .ppt is.
fn looks_like_cfb(head: &[u8]) -> bool {
    head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
}

fn looks_like_pdf(head: &[u8]) -> bool {
    // The header may be preceded by junk in the wild, so it is searched for rather
    // than required at offset zero.
    head.windows(5).take(1024).any(|w| w == b"%PDF-")
}

/// Read the first bytes of a file.
fn sniff(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    let mut buf = vec![0u8; SNIFF_LEN];
    let read = file.read(&mut buf)?;
    buf.truncate(read);
    Ok(buf)
}

/// Whether a ZIP payload declares encryption, which for OOXML means the container
/// itself is a CFB wrapper rather than a ZIP. Handled by the caller via container.
fn label_for(kind: DeckKind) -> &'static str {
    match kind {
        DeckKind::OoxmlPresentation => "PPTX",
        DeckKind::Odp => "ODP",
        DeckKind::LegacyPpt => "PPT",
        DeckKind::EncryptedOoxml => "PPTX（已加密）",
        DeckKind::Pdf => "PDF",
        DeckKind::Unsupported => "不支持",
    }
}

/// Extension without the dot, lower-cased.
pub fn declared_ext(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Classify a file.
///
/// The container decides first, then the extension refines it within that container.
/// A ZIP holding an ODP is an ODP; a CFB named .pptx is a legacy or encrypted deck,
/// which is exactly the case where trusting the name produces a corrupt-zip error.
pub fn detect(path: &Path) -> FormatInfo {
    let ext = declared_ext(path);
    let head = sniff(path).unwrap_or_default();

    let container = if looks_like_zip(&head) {
        ContainerKind::Zip
    } else if looks_like_cfb(&head) {
        ContainerKind::Cfb
    } else if looks_like_pdf(&head) {
        ContainerKind::Pdf
    } else {
        ContainerKind::Unknown
    };

    let (kind, encrypted, reason) = match container {
        ContainerKind::Pdf => (DeckKind::Pdf, false, None),
        ContainerKind::Zip => match ext.as_str() {
            "odp" => (DeckKind::Odp, false, None),
            "pptx" | "pptm" | "ppsx" | "ppsm" | "potx" => (DeckKind::OoxmlPresentation, false, None),
            // A ZIP that is not declared as a presentation is still worth trying as
            // OOXML: the extension may simply be wrong.
            _ => (DeckKind::OoxmlPresentation, false, None),
        },
        ContainerKind::Cfb => {
            // A password-protected OOXML file is a CFB with EncryptionInfo, and a
            // legacy .ppt is a CFB with PowerPoint Document. They are told apart when
            // the file is opened; here the extension is the better guess.
            if ext == "pptx" || ext == "pptm" || ext == "ppsx" {
                (DeckKind::EncryptedOoxml, true, None)
            } else if ext == "ppt" || ext == "pps" || ext == "pot" {
                (DeckKind::LegacyPpt, false, None)
            } else {
                (DeckKind::LegacyPpt, false, None)
            }
        }
        ContainerKind::Unknown => (
            DeckKind::Unsupported,
            false,
            Some("无法识别的文件格式".to_string()),
        ),
    };

    let expected_exts: &[&str] = match kind {
        DeckKind::OoxmlPresentation => &["pptx", "pptm", "ppsx", "ppsm", "potx"],
        DeckKind::Odp => &["odp"],
        DeckKind::LegacyPpt => &["ppt", "pps", "pot"],
        DeckKind::EncryptedOoxml => &["pptx", "pptm", "ppsx"],
        DeckKind::Pdf => &["pdf"],
        DeckKind::Unsupported => &[],
    };
    let ext_mismatch = !expected_exts.is_empty() && !expected_exts.contains(&ext.as_str());

    FormatInfo {
        kind,
        container,
        declared_ext: ext,
        ext_mismatch,
        encrypted,
        label: label_for(kind).to_string(),
        reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn recognises_a_zip_as_ooxml() {
        let (_d, path) = write("a.pptx", b"PK\x03\x04rest");
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::OoxmlPresentation);
        assert_eq!(info.container, ContainerKind::Zip);
        assert!(!info.ext_mismatch);
    }

    #[test]
    fn recognises_a_zip_named_odp() {
        let (_d, path) = write("a.odp", b"PK\x03\x04rest");
        assert_eq!(detect(&path).kind, DeckKind::Odp);
    }

    #[test]
    fn a_zip_with_a_wrong_extension_is_still_opened() {
        // The bytes are a ZIP, so it is a presentation whatever it is called; the
        // mismatch is reported rather than used to reject the file.
        let (_d, path) = write("deck.ppt", b"PK\x03\x04rest");
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::OoxmlPresentation);
        assert!(info.ext_mismatch);
    }

    #[test]
    fn recognises_a_legacy_ppt() {
        let (_d, path) = write("old.ppt", &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]);
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::LegacyPpt);
        assert_eq!(info.container, ContainerKind::Cfb);
    }

    #[test]
    fn a_cfb_named_pptx_is_treated_as_encrypted() {
        // This is the case that used to surface as a corrupt-zip error.
        let (_d, path) = write("locked.pptx", &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]);
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::EncryptedOoxml);
        assert!(info.encrypted);
    }

    #[test]
    fn recognises_pdf() {
        let (_d, path) = write("a.pdf", b"%PDF-1.7\n");
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::Pdf);
        assert_eq!(info.container, ContainerKind::Pdf);
    }

    #[test]
    fn rejects_unknown_bytes() {
        let (_d, path) = write("a.txt", b"hello");
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::Unsupported);
        assert!(info.reason.is_some());
    }

    #[test]
    fn missing_file_is_unsupported_not_a_panic() {
        let info = detect(Path::new("/definitely/not/here.pptx"));
        assert_eq!(info.kind, DeckKind::Unsupported);
    }
}
