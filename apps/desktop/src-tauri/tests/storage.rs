use paperpilot_desktop::{crypto::CryptoBox, storage::LocalStore};
use rusqlite::Connection;

#[test]
fn encrypted_values_use_random_nonces_and_reject_tampering() {
    let crypto = CryptoBox::new([7_u8; 32]);
    let first = crypto.encrypt(b"private research question").unwrap();
    let second = crypto.encrypt(b"private research question").unwrap();

    assert_ne!(first, second);
    assert_eq!(
        crypto.decrypt(&first).unwrap(),
        b"private research question"
    );

    let mut tampered = first;
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    assert_eq!(
        crypto.decrypt(&tampered).unwrap_err().to_string(),
        "encrypted value failed authentication"
    );
}

#[test]
fn project_content_is_encrypted_and_delete_cascades() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("paperpilot.db");
    let store = LocalStore::open(&database_path, [9_u8; 32]).unwrap();

    let project = store
        .create_project("耐药机制研究", "仅用于本地验证")
        .unwrap();
    store
        .insert_attachment(&project.id, "paper.pdf", "objects/paper.enc")
        .unwrap();
    assert_eq!(store.list_projects().unwrap()[0].name, "耐药机制研究");
    drop(store);

    let connection = Connection::open(&database_path).unwrap();
    let encrypted_name: Vec<u8> = connection
        .query_row("SELECT name_encrypted FROM projects", [], |row| row.get(0))
        .unwrap();
    assert!(!String::from_utf8_lossy(&encrypted_name).contains("耐药机制研究"));
    drop(connection);

    let store = LocalStore::open(&database_path, [9_u8; 32]).unwrap();
    store.delete_project(&project.id).unwrap();
    assert!(store.list_projects().unwrap().is_empty());
    assert_eq!(store.attachment_count().unwrap(), 0);
}
