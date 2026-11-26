use rand::RngCore;
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

const TOKEN_PATH: &str = "/opt/homeserver-agent/token";

pub fn load_or_create_token() -> String {
    if let Ok(existing) = fs::read_to_string(TOKEN_PATH) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }

    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = hex_encode(&bytes);

    if let Some(parent) = Path::new(TOKEN_PATH).parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut f) = fs::File::create(TOKEN_PATH) {
        let _ = f.write_all(token.as_bytes());
        let _ = f.set_permissions(std::fs::Permissions::from_mode(0o600));
    }

    token
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn is_valid(provided: Option<&str>, expected: &str) -> bool {
    match provided {
        Some(p) => constant_time_eq(p.as_bytes(), expected.as_bytes()),
        None => false,
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
