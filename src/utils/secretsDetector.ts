/* eslint-disable no-useless-escape */
import { Logger } from './logger';

const logger = Logger.getInstance();

/**
 * Result of a secrets scan on a file.
 */
export interface SecretsScanResult {
  hasSecrets: boolean;
  reasons: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Detects credentials, secrets, and sensitive data in file content.
 * Files flagged by this detector are excluded from structural analysis
 * to prevent accidental leakage through LLM context.
 */
export class SecretsDetector {

  /**
   * Patterns that indicate a file contains secrets.
   * Each entry: [regex pattern, description, severity]
   */
  private static readonly CONTENT_PATTERNS: Array<[RegExp, string, 'low' | 'medium' | 'high']> = [
    // API Keys & Tokens
    [/(?:api[_\-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}/i, 'API key', 'high'],
    [/(?:secret[_\-]?key|secretkey)\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}/i, 'Secret key', 'high'],
    [/(?:access[_\-]?token|accesstoken)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}/i, 'Access token', 'high'],
    [/(?:auth[_\-]?token|authtoken)\s*[:=]\s*['"][A-Za-z0-9_-]{16,}/i, 'Auth token', 'high'],
    [/bearer\s+[A-Za-z0-9_.\-]{20,}/i, 'Bearer token', 'high'],

    // AWS
    [/AKIA[0-9A-Z]{16}/i, 'AWS Access Key ID', 'high'],
    [/(?:aws[_-]?secret|aws_secret_access_key)\s*[:=]\s*['"][A-Za-z0-9/+=]{30,}/i, 'AWS Secret Key', 'high'],

    // Private Keys & Certificates
    [/-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/i, 'Private key', 'high'],
    [/-----BEGIN\s+CERTIFICATE-----/i, 'Certificate', 'medium'],
    [/-----BEGIN\s+PGP\s+PRIVATE/i, 'PGP private key', 'high'],

    // Database Connection Strings
    [/(?:mongodb|postgres|mysql|redis|amqp):\/\/[^\s'"]{10,}/i, 'Database connection string', 'high'],
    [/(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}/i, 'Password', 'high'],
    [/(?:db[_-]?password|database[_-]?password)\s*[:=]\s*['"][^'"]{4,}/i, 'Database password', 'high'],

    // GitHub / GitLab / Bitbucket tokens
    [/gh[pousr]_[A-Za-z0-9_]{30,}/i, 'GitHub token', 'high'],
    [/glpat-[A-Za-z0-9-]{20,}/i, 'GitLab token', 'high'],

    // Stripe
    [/sk_live_[A-Za-z0-9]{20,}/i, 'Stripe secret key', 'high'],
    [/rk_live_[A-Za-z0-9]{20,}/i, 'Stripe restricted key', 'high'],

    // Slack
    [/xox[baprs]-[A-Za-z0-9-]{10,}/i, 'Slack token', 'high'],

    // Google
    [/AIza[0-9A-Za-z_-]{35}/i, 'Google API key', 'high'],

    // JWT (hardcoded)
    [/(?:jwt[_-]?secret|jwt_secret_key)\s*[:=]\s*['"][^'"]{8,}/i, 'JWT secret', 'high'],

    // SSH
    [/(?:ssh[_-]?pass|sshpass)\s*[:=]\s*['"][^'"]{4,}/i, 'SSH password', 'high'],

    // Generic secrets in env-like formats
    [/(?:SECRET|TOKEN|CREDENTIAL|AUTH)[A-Z_]*\s*=\s*['"]?[A-Za-z0-9_\-/+=]{20,}/i, 'Environment secret', 'medium'],
  ];

  /**
   * Filenames that typically contain secrets.
   */
  private static readonly SENSITIVE_FILENAMES: Array<[RegExp, string]> = [
    [/\.env$/, '.env file'],
    [/\.env\.[a-z]+$/, '.env variant file'],
    [/\.env\.local$/, '.env.local file'],
    [/\.env\.production$/, '.env.production file'],
    [/\.pem$/, 'PEM certificate/key file'],
    [/\.key$/, 'Key file'],
    [/\.p12$/, 'PKCS12 certificate'],
    [/\.pfx$/, 'PFX certificate'],
    [/\.jks$/, 'Java keystore'],
    [/\.keystore$/, 'Keystore file'],
    [/id_rsa$/, 'SSH private key'],
    [/id_ed25519$/, 'SSH private key'],
    [/credentials\.json$/i, 'Credentials file'],
    [/secrets\.json$/i, 'Secrets file'],
    [/secrets\.ya?ml$/i, 'Secrets file'],
    [/\.htpasswd$/, 'htpasswd file'],
    [/\.netrc$/, 'netrc file'],
    [/service[_-]?account.*\.json$/i, 'Service account key'],
  ];

  /**
   * Scan file content and filename for secrets.
   */
  static scan(filePath: string, content: string): SecretsScanResult {
    const reasons: string[] = [];
    let highestSeverity: 'low' | 'medium' | 'high' = 'low';

    // Check filename
    const fileName = filePath.split(/[/\\]/).pop() || '';
    for (const [pattern, description] of this.SENSITIVE_FILENAMES) {
      if (pattern.test(fileName)) {
        reasons.push(`Filename match: ${description}`);
        highestSeverity = 'high';
      }
    }

    // Check content (scan first 5000 chars for performance)
    const scanContent = content.substring(0, 5000);
    for (const [pattern, description, severity] of this.CONTENT_PATTERNS) {
      if (pattern.test(scanContent)) {
        reasons.push(`Content match: ${description}`);
        if (severity === 'high') {
          highestSeverity = 'high';
        } else if (severity === 'medium' && highestSeverity !== 'high') {
          highestSeverity = 'medium';
        }
      }
    }

    if (reasons.length > 0) {
      logger.warn(`Secrets detected in ${filePath}: ${reasons.join(', ')}`);
    }

    return {
      hasSecrets: reasons.length > 0,
      reasons,
      severity: reasons.length > 0 ? highestSeverity : 'low',
    };
  }
}
