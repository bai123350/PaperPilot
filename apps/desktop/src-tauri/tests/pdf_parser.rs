use paperpilot_desktop::pdf_parser::{PdfParseError, PdfiumParser};

#[test]
#[ignore = "requires downloading the version-matched native PDFium DLL"]
fn pdfium_extracts_paginated_text_and_rejects_scanned_documents() {
    let pdfium = pdfium_bundled::bind_pdfium_silent().expect("PDFium should be available");
    let parser = PdfiumParser::new(&pdfium);

    let parsed = parser
        .parse(&single_page_pdf(Some("Evidence lives on page one")))
        .unwrap();
    assert_eq!(parsed.pages.len(), 1);
    assert_eq!(parsed.pages[0].page_number, 1);
    assert_eq!(parsed.pages[0].locator, "page 1");
    assert!(parsed.pages[0].text.contains("Evidence lives on page one"));

    let error = parser.parse(&single_page_pdf(None)).unwrap_err();
    assert_eq!(error, PdfParseError::ScannedPdfUnsupported);
}

fn single_page_pdf(text: Option<&str>) -> Vec<u8> {
    let content = text
        .map(|text| format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET"))
        .unwrap_or_default();
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_owned(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
    ];

    let mut bytes = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
    }
    let xref_offset = bytes.len();
    bytes.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    bytes.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.into_iter().skip(1) {
        bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    bytes.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    bytes
}
