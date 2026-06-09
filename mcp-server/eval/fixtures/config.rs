use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub workers: usize,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub features: HashMap<String, bool>,
    pub log_level: LogLevel,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

pub trait ConfigLoader {
    fn load(&self, path: &Path) -> Result<AppConfig, ConfigError>;
    fn validate(&self, cfg: &AppConfig) -> Result<(), ConfigError>;
}

pub struct JsonConfigLoader;

impl ConfigLoader for JsonConfigLoader {
    fn load(&self, path: &Path) -> Result<AppConfig, ConfigError> {
        let raw = fs::read_to_string(path).map_err(ConfigError::Io)?;
        let cfg: AppConfig = serde_json::from_str(&raw).map_err(ConfigError::Parse)?;
        self.validate(&cfg)?;
        Ok(cfg)
    }

    fn validate(&self, cfg: &AppConfig) -> Result<(), ConfigError> {
        if cfg.server.port == 0 {
            return Err(ConfigError::Invalid("port must be non-zero".to_string()));
        }
        if cfg.server.workers == 0 {
            return Err(ConfigError::Invalid("workers must be >= 1".to_string()));
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
    Parse(serde_json::Error),
    Invalid(String),
}

pub fn default_config() -> AppConfig {
    AppConfig {
        server: ServerConfig {
            host: "0.0.0.0".to_string(),
            port: 8080,
            workers: 4,
            timeout_ms: 30000,
        },
        features: HashMap::new(),
        log_level: LogLevel::Info,
    }
}
