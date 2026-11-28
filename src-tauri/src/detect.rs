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
        DeckKind::OoxmlDocument => "DOCX",
        DeckKind::LegacyDoc => "DOC",
        DeckKind::OoxmlSheet => "XLSX",
        DeckKind::LegacySheet => "XLS",
        DeckKind::EncryptedOoxml => "已加密",
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
            "docx" | "docm" | "dotx" => (DeckKind::OoxmlDocument, false, None),
            "xlsx" | "xlsm" | "xltx" => (DeckKind::OoxmlSheet, false, None),
            "pptx" | "pptm" | "ppsx" | "ppsm" | "potx" => {
                (DeckKind::OoxmlPresentation, false, None)
            }
            // An unknown extension on a ZIP is still worth trying as OOXML, and the
            // presentation form is what this app exists for.
            _ => (DeckKind::OoxmlPresentation, false, None),
        },
        ContainerKind::Cfb => {
            // A password-protected OOXML file is a CFB holding EncryptionInfo, and a
            // legacy binary document is a CFB holding its own stream. The container
            // alone cannot tell them apart, so the extension decides here.
            match ext.as_str() {
                "pptx" | "pptm" | "ppsx" | "docx" | "docm" | "xlsx" | "xlsm" => {
                    (DeckKind::EncryptedOoxml, true, None)
                }
                "doc" | "dot" => (DeckKind::LegacyDoc, false, None),
                "xls" | "xlt" | "xla" => (DeckKind::LegacySheet, false, None),
                _ => (DeckKind::LegacyPpt, false, None),
            }
        }
        // A CSV has no signature at all, so the container cannot identify it and the
        // extension is the only evidence there is. Without this a .csv was reported as
        // unsupported and could not be opened on the lite build, where there is no
        // engine to fall back to.
        //
        // The extension alone decides, deliberately: sniffing the first line for a comma
        // would claim every unknown text file as a sheet, and a .txt the user meant to
        // read as text is far more common than a table saved with no extension.
        ContainerKind::Unknown if crate::spreadsheet::is_delimited_ext(&ext) => {
            (DeckKind::OoxmlSheet, false, None)
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
        DeckKind::OoxmlDocument => &["docx", "docm", "dotx"],
        DeckKind::LegacyDoc => &["doc", "dot"],
        // A delimited text table is a sheet too, so a .csv is not reported as a file
        // whose name disagrees with its content.
        DeckKind::OoxmlSheet => &["xlsx", "xlsm", "xltx", "csv", "tsv"],
        DeckKind::LegacySheet => &["xls", "xlt", "xla"],
        DeckKind::EncryptedOoxml => &[
            "pptx", "pptm", "ppsx", "docx", "docm", "xlsx", "xlsm",
        ],
        DeckKind::Pdf => &["pdf"],
        DeckKind::Unsupported => &[],
    };
    let ext_mismatch = !expected_exts.is_empty() && !expected_exts.contains(&ext.as_str());

    FormatInfo {
        kind,
        container,
        declared_ext: ext.clone(),
        ext_mismatch,
        encrypted,
        label: label_for_sheet(kind, &ext),
        reason,
    }
}

/// The label shown to the user.
///
/// A delimited text table and an OOXML workbook are both opened as a sheet, but calling
/// a .csv an XLSX would be a lie the user can see: the label names what the file
/// actually is.
fn label_for_sheet(kind: DeckKind, ext: &str) -> String {
    if kind == DeckKind::OoxmlSheet {
        return match ext {
            "csv" => "CSV".to_string(),
            "tsv" => "TSV".to_string(),
            _ => label_for(kind).to_string(),
        };
    }
    label_for(kind).to_string()
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
    fn recognises_a_csv_as_a_sheet() {
        // A CSV has no signature, so this is the extension alone. Without it the file
        // was reported unsupported and could not be opened on the lite build at all.
        let (_d, path) = write("成绩.csv", b"\xD0\xD5\xC3\xFB,\xB7\xD6\xCA\xFD\r\n");
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::OoxmlSheet);
        assert_eq!(info.container, ContainerKind::Unknown);
        assert!(!info.encrypted);
        // The name matches the content, so it is not a mismatch.
        assert!(!info.ext_mismatch);
    }

    #[test]
    fn a_csv_is_labelled_csv_and_not_xlsx() {
        // The label is the one piece of text that tells the reader what they opened, so
        // calling their csv an xlsx would be a visible lie.
        let (_d, path) = write("a.csv", b"a,b\n1,2\n");
        assert_eq!(detect(&path).label, "CSV");
        let (_d2, tsv) = write("a.tsv", b"a\tb\n");
        assert_eq!(detect(&tsv).label, "TSV");
        // A real workbook keeps its own label.
        let (_d3, xlsx) = write("a.xlsx", b"PK\x03\x04rest");
        assert_eq!(detect(&xlsx).label, "XLSX");
    }

    #[test]
    fn a_text_file_is_still_not_a_sheet() {
        // Plain .txt is deliberately excluded: claiming it would stop a text file
        // opening at all, and prose is the commoner case.
        let (_d, path) = write("notes.txt", b"a,b,c\n1,2,3\n");
        assert_eq!(detect(&path).kind, DeckKind::Unsupported);
    }

    #[test]
    fn missing_file_is_unsupported_not_a_panic() {
        let info = detect(Path::new("/definitely/not/here.pptx"));
        assert_eq!(info.kind, DeckKind::Unsupported);
    }

    #[test]
    fn recognises_word_and_spreadsheet_containers() {
        let zip = b"PK\x03\x04rest";
        let (_d1, docx) = write("a.docx", zip);
        assert_eq!(detect(&docx).kind, DeckKind::OoxmlDocument);
        let (_d2, xlsx) = write("a.xlsx", zip);
        assert_eq!(detect(&xlsx).kind, DeckKind::OoxmlSheet);

        // Legacy forms are CFB containers distinguished only by extension.
        let cfb = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0];
        let (_d3, doc) = write("a.doc", cfb);
        assert_eq!(detect(&doc).kind, DeckKind::LegacyDoc);
        let (_d4, xls) = write("a.xls", cfb);
        assert_eq!(detect(&xls).kind, DeckKind::LegacySheet);
    }

    #[test]
    fn a_locked_spreadsheet_is_encrypted_not_legacy() {
        // An encrypted OOXML file is a CFB; only the extension says it is Excel.
        let cfb = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0];
        let (_d, path) = write("locked.xlsx", cfb);
        let info = detect(&path);
        assert_eq!(info.kind, DeckKind::EncryptedOoxml);
        assert!(info.encrypted);
    }
}
