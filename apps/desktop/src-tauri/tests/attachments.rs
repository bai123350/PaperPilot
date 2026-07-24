use chrono::{Duration, Utc};
use paperpilot_desktop::attachments::{AttachmentStore, PdfError};

#[test]
fn pdfs_are_signature_checked_encrypted_and_removed_after_24_hours() {
    let directory = tempfile::tempdir().unwrap();
    let store = AttachmentStore::new(directory.path(), [6_u8; 32]).unwrap();
    let created_at = Utc::now() - Duration::hours(25);
    let saved = store
        .save_pdf(
            "project-1",
            "paper.pdf",
            b"%PDF-1.7\nprivate paper text",
            created_at,
        )
        .unwrap();

    let encrypted = std::fs::read(&saved.path).unwrap();
    assert!(!String::from_utf8_lossy(&encrypted).contains("private paper text"));
    assert_eq!(
        store.read_pdf(&saved).unwrap(),
        b"%PDF-1.7\nprivate paper text"
    );

    assert_eq!(store.cleanup_expired(Utc::now(), 24).unwrap(), 1);
    assert!(!saved.path.exists());
}

#[test]
fn non_pdf_content_is_rejected_before_it_is_written() {
    let directory = tempfile::tempdir().unwrap();
    let store = AttachmentStore::new(directory.path(), [6_u8; 32]).unwrap();
    let error = store
        .save_pdf("project-1", "paper.pdf", b"not a pdf", Utc::now())
        .unwrap_err();
    assert_eq!(error, PdfError::InvalidSignature);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}
