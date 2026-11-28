//! Read a presentation structure out of OOXML.
//!
//! OWNER: subagent-rust-data
//!
//! The native renderer needs to know the slide size, the slide order, and where the
//! masters and themes are before it can draw anything.

use crate::types::PageSize;
use crate::zip_vfs::ZipVfs;

/// The part that describes the deck.
const PRESENTATION_PART: &str = "ppt/presentation.xml";
/// Its relationships, which name the slides by id.
const PRESENTATION_RELS_PART: &str = "ppt/_rels/presentation.xml.rels";
/// The macro project a .pptm carries and a .pptx does not.
const MACRO_PART: &str = "ppt/vbaProject.bin";

/// EMU per CSS pixel at 96 DPI. OOXML uses 914400 EMU per inch, and the renderer
/// draws in CSS pixels, so this is the one conversion factor either side needs.
const EMU_PER_PX: f64 = 914400.0 / 96.0;
/// PowerPoint 4:3 default, used when a deck declares no slide size.
const DEFAULT_CX: i64 = 9144000;
const DEFAULT_CY: i64 = 6858000;

/// What the native renderer needs to start.
pub struct PresentationIndex {
    pub slide_size: PageSize,
    pub slides: Vec<SlideRef>,
    pub masters: Vec<String>,
    pub themes: Vec<String>,
    pub has_macros: bool,
}

pub struct SlideRef {
    pub path: String,
}

/// Build the index for a PPTX.
pub fn build_presentation_index(vfs: &ZipVfs) -> Option<PresentationIndex> {
    let presentation = vfs.read_text(PRESENTATION_PART).ok()?;
    let rels_xml = vfs.read_text(PRESENTATION_RELS_PART).unwrap_or_default();
    let rels = parse_relationships(&rels_xml);

    // Slide order comes from sldIdLst, never from the rels order or the file names:
    // a deck is free to number its parts any way it likes.
    let mut slides = Vec::new();
    for tag in tags(&presentation, "sldId") {
        // Only r:id names a relationship; the bare id is a slide number and resolving
        // it would point at an unrelated part.
        let Some(rel_id) = attribute(tag, "r:id") else {
            continue;
        };
        let Some(target) = rels.iter().find(|rel| rel.id == rel_id) else {
            continue;
        };
        slides.push(SlideRef {
            path: resolve_part_target(PRESENTATION_PART, &target.target),
        });
    }
    if slides.is_empty() {
        // Without slides there is nothing to render, so the caller converts instead.
        return None;
    }

    Some(PresentationIndex {
        slide_size: slide_size(&presentation),
        slides,
        masters: master_paths(&presentation, &rels),
        themes: theme_paths(vfs, &presentation, &rels),
        has_macros: vfs.has(MACRO_PART),
    })
}

/// Slide size in CSS pixels, falling back to PowerPoint 4:3 when it is not declared.
fn slide_size(presentation: &str) -> PageSize {
    let tag = tags(presentation, "sldSz").into_iter().next().unwrap_or_default();
    let cx = attribute(tag, "cx").and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0);
    let cy = attribute(tag, "cy").and_then(|v| v.trim().parse::<i64>().ok()).unwrap_or(0);
    let (cx, cy) = if cx > 0 && cy > 0 {
        (cx, cy)
    } else {
        (DEFAULT_CX, DEFAULT_CY)
    };
    PageSize {
        width: emu_to_px(cx),
        height: emu_to_px(cy),
    }
}

/// EMU to CSS pixels. The renderer draws every element in this unit, so the slide box
/// has to be in it too or nothing lines up.
fn emu_to_px(emu: i64) -> f64 {
    emu as f64 / EMU_PER_PX
}

/// Master parts, in the order the deck lists them.
fn master_paths(presentation: &str, rels: &[Relationship]) -> Vec<String> {
    let mut masters: Vec<String> = Vec::new();

    for tag in tags(presentation, "sldMasterId") {
        let Some(rel_id) = attribute(tag, "r:id") else {
            continue;
        };
        if let Some(rel) = rels.iter().find(|rel| rel.id == rel_id) {
            push_unique(&mut masters, resolve_part_target(PRESENTATION_PART, &rel.target));
        }
    }

    // A deck that omits sldMasterIdLst still names its masters in the relationships.
    for rel in rels {
        if rel.kind.ends_with("/slideMaster") {
            push_unique(&mut masters, resolve_part_target(PRESENTATION_PART, &rel.target));
        }
    }
    masters
}

/// Theme parts.
///
/// A theme is named by the master that uses it, not by the presentation, so the
/// master relationships are read as well as any theme the presentation declares
/// itself.
fn theme_paths(vfs: &ZipVfs, presentation: &str, rels: &[Relationship]) -> Vec<String> {
    let mut themes: Vec<String> = Vec::new();

    for rel in rels {
        if rel.kind.ends_with("/theme") {
            push_unique(&mut themes, resolve_part_target(PRESENTATION_PART, &rel.target));
        }
    }

    for master in master_paths(presentation, rels) {
        let rels_part = rels_part_for(&master);
        let Ok(xml) = vfs.read_text(&rels_part) else {
            continue;
        };
        for rel in parse_relationships(&xml) {
            if rel.kind.ends_with("/theme") {
                push_unique(&mut themes, resolve_part_target(&master, &rel.target));
            }
        }
    }
    themes
}

fn push_unique(list: &mut Vec<String>, value: String) {
    if !value.is_empty() && !list.contains(&value) {
        list.push(value);
    }
}

/// One entry of a relationships part.
struct Relationship {
    id: String,
    kind: String,
    target: String,
}

fn parse_relationships(xml: &str) -> Vec<Relationship> {
    let mut out = Vec::new();
    for tag in tags(xml, "Relationship") {
        let id = attribute(tag, "Id");
        let kind = attribute(tag, "Type");
        let target = attribute(tag, "Target");
        if let (Some(id), Some(kind), Some(target)) = (id, kind, target) {
            out.push(Relationship { id, kind, target });
        }
    }
    out
}

/// Resolve a relationship target against the part that declared it.
///
/// Targets are either absolute within the archive (/ppt/slides/slide1.xml) or
/// relative to the declaring part directory, and relative ones routinely walk up
/// with "..".
fn resolve_part_target(base_part: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.trim_start_matches('/').to_string();
    }

    let base_dir = match base_part.rfind('/') {
        Some(slash) => &base_part[..slash],
        None => "",
    };
    let joined = if base_dir.is_empty() {
        target.to_string()
    } else {
        format!("{base_dir}/{target}")
    };

    let mut parts: Vec<&str> = Vec::new();
    for segment in joined.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

/// The relationships part for a given part:
/// ppt/slides/slide1.xml -> ppt/slides/_rels/slide1.xml.rels
fn rels_part_for(part: &str) -> String {
    match part.rfind('/') {
        Some(slash) => format!("{}/_rels/{}.rels", &part[..slash], &part[slash + 1..]),
        None => format!("_rels/{part}.rels"),
    }
}

/// The attribute text of every element with the given local name, in document order.
///
/// This is a scanner, not an XML parser: it only has to read a handful of attributes
/// out of two well-formed parts, and pulling in a parser to do it would be a
/// dependency for nothing. It ignores prefixes, so p:sldId and sldId both match.
fn tags<'a>(xml: &'a str, local: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let bytes = xml.as_bytes();
    let mut at = 0usize;

    while at < bytes.len() {
        if bytes[at] != b'<' {
            at += 1;
            continue;
        }
        // Slicing the string here would be a panic waiting to happen: `at` can sit in
        // the middle of a multi-byte character, so the scan stays on bytes and only
        // slices at ASCII boundaries it has just verified.
        if bytes[at..].starts_with(b"<!--") {
            match find_bytes(&bytes[at..], b"-->") {
                Some(end) => {
                    at += end + 3;
                    continue;
                }
                None => break,
            }
        }

        let name_start = at + 1;
        if name_start >= bytes.len() {
            break;
        }
        // Closing tags, declarations, and CDATA carry no attributes worth reading.
        if matches!(bytes[name_start], b'/' | b'!' | b'?') {
            at = name_start;
            continue;
        }

        let mut name_end = name_start;
        while name_end < bytes.len() && !is_name_end(bytes[name_end]) {
            name_end += 1;
        }
        let qualified = &xml[name_start..name_end];
        let name = match qualified.rfind(':') {
            Some(colon) => &qualified[colon + 1..],
            None => qualified,
        };

        // Everything up to the closing angle bracket, quotes respected so a ">"
        // inside an attribute value does not end the tag early.
        let mut end = name_end;
        let mut quote: Option<u8> = None;
        while end < bytes.len() {
            let byte = bytes[end];
            match quote {
                Some(open) => {
                    if byte == open {
                        quote = None;
                    }
                }
                None => {
                    if byte == b'"' || byte == b'\'' {
                        quote = Some(byte);
                    } else if byte == b'>' {
                        break;
                    }
                }
            }
            end += 1;
        }

        if name == local {
            out.push(&xml[name_end..end]);
        }
        at = end + 1;
    }
    out
}

/// Find a byte pattern, so the scanner never has to slice a &str at an unverified
/// offset.
fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn is_name_end(byte: u8) -> bool {
    byte.is_ascii_whitespace() || byte == b'>' || byte == b'/'
}

fn is_attribute_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'-' | b'_' | b'.')
}

/// Read one attribute value out of a tag body, whatever the quote style.
fn attribute(tag: &str, wanted: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let mut at = 0usize;

    while at < bytes.len() {
        if !(bytes[at].is_ascii_alphabetic() || bytes[at] == b'_') {
            at += 1;
            continue;
        }
        let name_start = at;
        while at < bytes.len() && is_attribute_char(bytes[at]) {
            at += 1;
        }
        let name = &tag[name_start..at];

        let mut cursor = at;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return None;
        }
        let quote = bytes[cursor];
        if quote != b'"' && quote != b'\'' {
            continue;
        }

        let value_start = cursor + 1;
        let mut value_end = value_start;
        while value_end < bytes.len() && bytes[value_end] != quote {
            value_end += 1;
        }
        if value_end >= bytes.len() {
            return None;
        }

        if name.eq_ignore_ascii_case(wanted) {
            return Some(tag[value_start..value_end].to_string());
        }
        at = value_end + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::zip_vfs::test_zip::{build, Fixture};

    /// A 16:9 presentation with one master and two slides.
    const PRESENTATION: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>"#;

    const PRESENTATION_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>"#;

    /// The same deck, with the two slide ids swapped in sldIdLst.
    const PRESENTATION_SWAPPED: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId3"/>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>"#;

    /// The same deck with no sldSz at all.
    const PRESENTATION_NO_SIZE: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>"#;

    const MASTER_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>"#;

    fn deck(extra: Vec<Fixture>) -> Vec<Fixture> {
        let mut entries = vec![
            Fixture::stored(PRESENTATION_PART, PRESENTATION.as_bytes()),
            Fixture::stored(PRESENTATION_RELS_PART, PRESENTATION_RELS.as_bytes()),
            Fixture::stored("ppt/slideMasters/slideMaster1.xml", b"<p:sldMaster/>"),
            Fixture::stored(
                "ppt/slideMasters/_rels/slideMaster1.xml.rels",
                MASTER_RELS.as_bytes(),
            ),
            Fixture::stored("ppt/theme/theme1.xml", b"<a:theme/>"),
            Fixture::stored("ppt/slides/slide1.xml", b"<p:sld/>"),
            Fixture::stored("ppt/slides/slide2.xml", b"<p:sld/>"),
        ];
        entries.extend(extra);
        entries
    }

    fn open(entries: &[Fixture]) -> (tempfile::TempDir, ZipVfs) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deck.pptx");
        std::fs::write(&path, build(entries)).unwrap();
        let vfs = ZipVfs::open(&path).unwrap();
        (dir, vfs)
    }

    fn slide_paths(index: &PresentationIndex) -> Vec<String> {
        index.slides.iter().map(|s| s.path.clone()).collect()
    }

    #[test]
    fn reads_the_slide_size_in_pixels() {
        let (_d, vfs) = open(&deck(vec![]));
        let index = build_presentation_index(&vfs).unwrap();
        // 12192000 EMU is 1280 px at 96 DPI: the 16:9 size PowerPoint writes.
        assert!((index.slide_size.width - 1280.0).abs() < 0.001);
        assert!((index.slide_size.height - 720.0).abs() < 0.001);
    }

    #[test]
    fn slides_follow_the_declared_order() {
        let (_d, vfs) = open(&deck(vec![]));
        let index = build_presentation_index(&vfs).unwrap();
        assert_eq!(
            slide_paths(&index),
            vec!["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]
        );
    }

    #[test]
    fn slide_order_comes_from_the_id_list_not_the_part_names() {
        // The id list names slide2 first and slide1 second, so that is the order. The
        // part names must not be allowed to override it.
        let entries = vec![
            Fixture::stored(PRESENTATION_PART, PRESENTATION_SWAPPED.as_bytes()),
            Fixture::stored(PRESENTATION_RELS_PART, PRESENTATION_RELS.as_bytes()),
            Fixture::stored("ppt/slides/slide1.xml", b"<p:sld/>"),
            Fixture::stored("ppt/slides/slide2.xml", b"<p:sld/>"),
        ];
        let (_d, vfs) = open(&entries);
        let index = build_presentation_index(&vfs).unwrap();
        assert_eq!(
            slide_paths(&index),
            vec!["ppt/slides/slide2.xml", "ppt/slides/slide1.xml"]
        );
    }

    #[test]
    fn collects_masters_and_themes() {
        let (_d, vfs) = open(&deck(vec![]));
        let index = build_presentation_index(&vfs).unwrap();
        assert_eq!(index.masters, vec!["ppt/slideMasters/slideMaster1.xml"]);
        // The theme is named by the master, not by the presentation.
        assert_eq!(index.themes, vec!["ppt/theme/theme1.xml"]);
    }

    #[test]
    fn reports_macros_when_the_vba_project_is_present() {
        let (_d, vfs) = open(&deck(vec![]));
        assert!(!build_presentation_index(&vfs).unwrap().has_macros);

        let (_macros_dir, macros_vfs) =
            open(&deck(vec![Fixture::stored("ppt/vbaProject.bin", &[0, 1])]));
        assert!(build_presentation_index(&macros_vfs).unwrap().has_macros);
    }

    #[test]
    fn a_missing_presentation_part_means_needs_conversion() {
        let (_d, vfs) = open(&[
            Fixture::stored("ppt/slides/slide1.xml", b"<p:sld/>"),
            Fixture::stored("word/document.xml", b"<w:document/>"),
        ]);
        assert!(build_presentation_index(&vfs).is_none());
    }

    #[test]
    fn an_unparseable_presentation_means_needs_conversion() {
        let (_d, vfs) = open(&[
            Fixture::stored(PRESENTATION_PART, b"not xml at all"),
            Fixture::stored(PRESENTATION_RELS_PART, PRESENTATION_RELS.as_bytes()),
        ]);
        assert!(build_presentation_index(&vfs).is_none());
    }

    #[test]
    fn a_deck_with_no_resolvable_slides_means_needs_conversion() {
        let orphaned = PRESENTATION.replace("rId2", "rId99").replace("rId3", "rId98");
        let (_d, vfs) = open(&[
            Fixture::stored(PRESENTATION_PART, orphaned.as_bytes()),
            Fixture::stored(PRESENTATION_RELS_PART, PRESENTATION_RELS.as_bytes()),
        ]);
        assert!(build_presentation_index(&vfs).is_none());
    }

    #[test]
    fn a_deck_without_a_slide_size_gets_the_4_3_default() {
        let no_size = PRESENTATION_NO_SIZE;
        let (_d, vfs) = open(&[
            Fixture::stored(PRESENTATION_PART, no_size.as_bytes()),
            Fixture::stored(PRESENTATION_RELS_PART, PRESENTATION_RELS.as_bytes()),
            Fixture::stored("ppt/slides/slide1.xml", b"<p:sld/>"),
            Fixture::stored("ppt/slides/slide2.xml", b"<p:sld/>"),
        ]);
        let index = build_presentation_index(&vfs).unwrap();
        assert!((index.slide_size.width - 960.0).abs() < 0.001);
        assert!((index.slide_size.height - 720.0).abs() < 0.001);
    }

    #[test]
    fn resolves_absolute_and_relative_targets() {
        assert_eq!(
            resolve_part_target("ppt/presentation.xml", "slides/slide1.xml"),
            "ppt/slides/slide1.xml"
        );
        assert_eq!(
            resolve_part_target("ppt/slides/slide1.xml", "../slideLayouts/slideLayout1.xml"),
            "ppt/slideLayouts/slideLayout1.xml"
        );
        assert_eq!(
            resolve_part_target("ppt/presentation.xml", "/ppt/theme/theme2.xml"),
            "ppt/theme/theme2.xml"
        );
    }

    #[test]
    fn names_the_relationships_part_for_a_part() {
        assert_eq!(
            rels_part_for("ppt/slides/slide1.xml"),
            "ppt/slides/_rels/slide1.xml.rels"
        );
        assert_eq!(rels_part_for("a.xml"), "_rels/a.xml.rels");
    }

    #[test]
    fn reads_attributes_whatever_the_quote_style() {
        let double = attribute(" r:id=\"rId2\" id=\"256\"", "r:id");
        assert_eq!(double.as_deref(), Some("rId2"));
        let single = attribute(" id='7'", "id");
        assert_eq!(single.as_deref(), Some("7"));
        assert_eq!(attribute(" cx=\"1280\"", "cy"), None);
    }

    #[test]
    fn ignores_a_commented_out_slide() {
        // A commented-out sldId would otherwise resolve through rId1 to the master and
        // add a slide that does not exist.
        let commented = PRESENTATION.replace(
            "<p:sldIdLst>",
            "<p:sldIdLst><!-- <p:sldId id=\"9\" r:id=\"rId1\"/> -->",
        );
        let (_d, vfs) = open(&[
            Fixture::stored(PRESENTATION_PART, commented.as_bytes()),
            Fixture::stored(PRESENTATION_RELS_PART, PRESENTATION_RELS.as_bytes()),
            Fixture::stored("ppt/slideMasters/slideMaster1.xml", b"<p:sldMaster/>"),
            Fixture::stored("ppt/slides/slide1.xml", b"<p:sld/>"),
            Fixture::stored("ppt/slides/slide2.xml", b"<p:sld/>"),
        ]);
        let index = build_presentation_index(&vfs).unwrap();
        assert_eq!(index.slides.len(), 2);
    }
}