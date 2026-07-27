use paperpilot_desktop::runtime::{
    DesktopRuntimeConfig, RuntimeError, load_or_create_installation_id,
};

#[test]
fn demo_mode_is_offline_by_default_and_live_mode_requires_a_gateway() {
    assert_eq!(
        DesktopRuntimeConfig::from_values(None, None).unwrap(),
        DesktopRuntimeConfig {
            demo_mode: true,
            gateway_url: None,
        }
    );
    assert!(matches!(
        DesktopRuntimeConfig::from_values(Some("false"), None),
        Err(RuntimeError::MissingGatewayUrl)
    ));
    assert_eq!(
        DesktopRuntimeConfig::from_values(Some("0"), Some(" https://gateway.example/ ")).unwrap(),
        DesktopRuntimeConfig {
            demo_mode: false,
            gateway_url: Some("https://gateway.example/".into()),
        }
    );
}

#[test]
fn installation_identity_is_created_once_and_reused() {
    let directory = tempfile::tempdir().unwrap();
    let first = load_or_create_installation_id(directory.path()).unwrap();
    let second = load_or_create_installation_id(directory.path()).unwrap();
    assert_eq!(first, second);
    assert!(uuid::Uuid::parse_str(&first).is_ok());
}
