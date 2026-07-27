use std::path::Path;

use pdfium_render::prelude::{Pdfium, PdfiumError};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPdf {
    pub pages: Vec<ParsedPdfPage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPdfPage {
    pub page_number: u32,
    pub locator: String,
    pub text: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PdfParseError {
    #[error("the attachment does not have a PDF signature")]
    InvalidSignature,
    #[error("PDFium is unavailable: {0}")]
    PdfiumUnavailable(String),
    #[error("PDF parsing failed: {0}")]
    ParseFailed(String),
    #[error("this PDF appears to be scanned; OCR is not supported in the MVP")]
    ScannedPdfUnsupported,
}

pub struct PdfiumParser<'a> {
    pdfium: &'a Pdfium,
}

impl<'a> PdfiumParser<'a> {
    pub fn new(pdfium: &'a Pdfium) -> Self {
        Self { pdfium }
    }

    pub fn parse(&self, bytes: &[u8]) -> Result<ParsedPdf, PdfParseError> {
        if !bytes.starts_with(b"%PDF-") {
            return Err(PdfParseError::InvalidSignature);
        }

        let document = self
            .pdfium
            .load_pdf_from_byte_slice(bytes, None)
            .map_err(parse_error)?;
        let page_texts = document
            .pages()
            .iter()
            .map(|page| page.text().map(|text| text.all()).map_err(parse_error))
            .collect::<Result<Vec<_>, _>>()?;
        parsed_from_page_texts(page_texts)
    }
}

pub fn bind_pdfium_from_path(path: &Path) -> Result<Pdfium, PdfParseError> {
    Pdfium::bind_to_library(path)
        .map(Pdfium::new)
        .map_err(|error| PdfParseError::PdfiumUnavailable(error.to_string()))
}

fn parse_error(error: PdfiumError) -> PdfParseError {
    PdfParseError::ParseFailed(error.to_string())
}

fn parsed_from_page_texts(page_texts: Vec<String>) -> Result<ParsedPdf, PdfParseError> {
    if page_texts.iter().all(|text| text.trim().is_empty()) {
        return Err(PdfParseError::ScannedPdfUnsupported);
    }
    Ok(ParsedPdf {
        pages: page_texts
            .into_iter()
            .enumerate()
            .map(|(index, text)| {
                let page_number = index as u32 + 1;
                ParsedPdfPage {
                    page_number,
                    locator: format!("page {page_number}"),
                    text,
                }
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::{PdfParseError, parsed_from_page_texts};

    #[test]
    fn extracted_text_is_paginated_and_empty_documents_are_treated_as_scans() {
        let parsed =
            parsed_from_page_texts(vec!["first page".into(), "second page".into()]).unwrap();
        assert_eq!(parsed.pages[0].page_number, 1);
        assert_eq!(parsed.pages[1].locator, "page 2");
        assert_eq!(
            parsed_from_page_texts(vec![" ".into(), String::new()]),
            Err(PdfParseError::ScannedPdfUnsupported)
        );
    }
}
