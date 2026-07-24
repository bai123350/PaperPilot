use paperpilot_desktop::key_management::load_or_create_master_key;

#[test]
fn windows_dpapi_protects_and_restores_the_local_master_key() {
    let directory = tempfile::tempdir().unwrap();
    let first = load_or_create_master_key(directory.path()).unwrap();
    let second = load_or_create_master_key(directory.path()).unwrap();

    assert_eq!(first, second);
    assert_eq!(first.len(), 32);
    let protected = std::fs::read(directory.path().join("master-key.dpapi")).unwrap();
    assert_ne!(protected, first);
    assert!(!protected.windows(first.len()).any(|window| window == first));
}
