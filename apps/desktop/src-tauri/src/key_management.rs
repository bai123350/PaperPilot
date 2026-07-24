use std::{
    fs,
    path::{Path, PathBuf},
};

use rand::Rng;
use thiserror::Error;

const KEY_LENGTH: usize = 32;
const ENTROPY: &[u8] = b"PaperPilot desktop master key v1";

#[derive(Debug, Error)]
pub enum KeyError {
    #[error("master key storage is unavailable")]
    Io(#[from] std::io::Error),
    #[error("Windows could not protect the local master key")]
    Protect,
    #[error("Windows could not unlock the local master key")]
    Unprotect,
    #[error("protected master key has an invalid length")]
    InvalidLength,
    #[error("DPAPI master keys require Windows")]
    UnsupportedPlatform,
}

pub fn load_or_create_master_key(data_dir: &Path) -> Result<[u8; KEY_LENGTH], KeyError> {
    fs::create_dir_all(data_dir)?;
    let path = data_dir.join("master-key.dpapi");
    if path.exists() {
        return unprotect_key(&path);
    }

    let mut key = [0_u8; KEY_LENGTH];
    rand::rng().fill(&mut key);
    protect_key(&path, &key)?;
    Ok(key)
}

#[cfg(windows)]
fn protect_key(path: &Path, key: &[u8; KEY_LENGTH]) -> Result<(), KeyError> {
    use windows_dpapi::{Scope, encrypt_data};

    let protected =
        encrypt_data(key, Scope::User, Some(ENTROPY)).map_err(|_| KeyError::Protect)?;
    let temporary = temporary_path(path);
    fs::write(&temporary, protected)?;
    fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(not(windows))]
fn protect_key(_path: &Path, _key: &[u8; KEY_LENGTH]) -> Result<(), KeyError> {
    Err(KeyError::UnsupportedPlatform)
}

#[cfg(windows)]
fn unprotect_key(path: &Path) -> Result<[u8; KEY_LENGTH], KeyError> {
    use windows_dpapi::{Scope, decrypt_data};

    let protected = fs::read(path)?;
    let decrypted =
        decrypt_data(&protected, Scope::User, Some(ENTROPY)).map_err(|_| KeyError::Unprotect)?;
    decrypted
        .try_into()
        .map_err(|_| KeyError::InvalidLength)
}

#[cfg(not(windows))]
fn unprotect_key(_path: &Path) -> Result<[u8; KEY_LENGTH], KeyError> {
    Err(KeyError::UnsupportedPlatform)
}

fn temporary_path(path: &Path) -> PathBuf {
    path.with_extension(format!("tmp-{}", std::process::id()))
}
