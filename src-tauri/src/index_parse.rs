//! Read a presentation's structure out of OOXML.
//!
//! OWNER: subagent-rust-data
//!
//! The native renderer needs to know the slide size, the slide order, and where the
//! masters and themes are before it can draw anything.

use crate::types::PageSize;
use crate::zip_vfs::ZipVfs;

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
    todo!("subagent-rust-data")
}
