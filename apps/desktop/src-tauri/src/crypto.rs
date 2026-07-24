use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use rand::Rng;
use thiserror::Error;

const FORMAT_VERSION: u8 = 1;
const NONCE_LENGTH: usize = 12;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CryptoError {
    #[error("encrypted value has an unsupported format")]
    InvalidFormat,
    #[error("encrypted value failed authentication")]
    Authentication,
}

#[derive(Clone)]
pub struct CryptoBox {
    cipher: Aes256Gcm,
}

impl CryptoBox {
    pub fn new(key: [u8; 32]) -> Self {
        Self {
            cipher: Aes256Gcm::new_from_slice(&key).expect("AES-256 requires a 32-byte key"),
        }
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
        self.encrypt_with_aad(plaintext, b"")
    }

    pub fn decrypt(&self, encrypted: &[u8]) -> Result<Vec<u8>, CryptoError> {
        self.decrypt_with_aad(encrypted, b"")
    }

    pub fn encrypt_with_aad(
        &self,
        plaintext: &[u8],
        associated_data: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let mut nonce_bytes = [0_u8; NONCE_LENGTH];
        rand::rng().fill(&mut nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: plaintext,
                    aad: associated_data,
                },
            )
            .map_err(|_| CryptoError::Authentication)?;
        let mut output = Vec::with_capacity(1 + NONCE_LENGTH + ciphertext.len());
        output.push(FORMAT_VERSION);
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    pub fn decrypt_with_aad(
        &self,
        encrypted: &[u8],
        associated_data: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        if encrypted.len() <= 1 + NONCE_LENGTH || encrypted[0] != FORMAT_VERSION {
            return Err(CryptoError::InvalidFormat);
        }
        let nonce = Nonce::from_slice(&encrypted[1..1 + NONCE_LENGTH]);
        self.cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &encrypted[1 + NONCE_LENGTH..],
                    aad: associated_data,
                },
            )
            .map_err(|_| CryptoError::Authentication)
    }
}
