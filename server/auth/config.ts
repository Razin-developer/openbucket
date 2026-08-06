const DEFAULT_DATABASE = "openbucket_web";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AuthConfig = {
  mongodbUri: string;
  database: string;
  authSecret: Buffer;
  allowSignup: boolean;
  sessionTtlSeconds: number;
  adminEmail: string | null;
  adminPassword: Buffer | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
};

class AuthConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthConfigurationError";
    this.code = code;
  }
}

function configurationError(code: string, message: string): never {
  throw new AuthConfigurationError(code, message);
}

function requireValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) configurationError(`AUTH_CONFIG_${name}_REQUIRED`, `${name} is required.`);
  return value;
}

function readMongoUri(): string {
  const configured = requireValue("MONGODB_URI");
  const standardIndex = configured.indexOf("mongodb://");
  const srvIndex = configured.indexOf("mongodb+srv://");
  const candidates = [standardIndex, srvIndex].filter((index) => index >= 0);
  if (candidates.length === 0) return configured;

  let normalized = configured.slice(Math.min(...candidates)).trim();
  if (normalized.endsWith("\"") || normalized.endsWith("'")) {
    normalized = normalized.slice(0, -1).trim();
  }
  return normalized;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function isLoopbackMongoUri(uri: string): boolean {
  if (!uri.startsWith("mongodb://")) return false;
  const authority = uri.slice("mongodb://".length).split(/[/?]/, 1)[0];
  const hosts = authority.slice(authority.lastIndexOf("@") + 1).split(",");
  return hosts.length > 0 && hosts.every((entry) => {
    const value = entry.trim().toLowerCase();
    const hostname = value.startsWith("[")
      ? value.slice(1, value.indexOf("]"))
      : value.split(":", 1)[0];
    return hostname === "localhost" || hostname === "::1" || /^127(?:\.[0-9]{1,3}){3}$/.test(hostname);
  });
}

function usesTls(uri: string): boolean {
  const query = uri.includes("?") ? uri.slice(uri.indexOf("?") + 1) : "";
  const parameters = new URLSearchParams(query);
  const explicit = parameters.get("tls") ?? parameters.get("ssl");
  if (explicit?.toLowerCase() === "false") return false;
  if (explicit?.toLowerCase() === "true") return true;
  return uri.startsWith("mongodb+srv://");
}

export function getAuthConfig(): AuthConfig {
  const mongodbUri = readMongoUri();
  if (!mongodbUri.startsWith("mongodb://") && !mongodbUri.startsWith("mongodb+srv://")) {
    configurationError("AUTH_CONFIG_MONGODB_URI_SCHEME", "MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme.");
  }

  const database = process.env.MONGODB_DATABASE?.trim() || DEFAULT_DATABASE;
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) {
    configurationError("AUTH_CONFIG_MONGODB_DATABASE_INVALID", "MONGODB_DATABASE must contain 1-63 letters, numbers, underscores, or hyphens.");
  }
  if (isProduction() && !isLoopbackMongoUri(mongodbUri) && !usesTls(mongodbUri)) {
    configurationError("AUTH_CONFIG_MONGODB_URI_TLS_REQUIRED", "Production MONGODB_URI must use TLS.");
  }

  const authSecretValue = requireValue("OPENBUCKET_AUTH_SECRET");
  const authSecret = Buffer.from(authSecretValue, "utf8");
  if (authSecret.byteLength < 32) {
    configurationError("AUTH_CONFIG_AUTH_SECRET_TOO_SHORT", "OPENBUCKET_AUTH_SECRET must contain at least 32 UTF-8 bytes.");
  }

  // Self-serve account creation is open by default; set OPENBUCKET_ALLOW_SIGNUP=false to close it.
  const allowSignupRaw = process.env.OPENBUCKET_ALLOW_SIGNUP?.trim().toLowerCase();
  const allowSignup = allowSignupRaw !== "false";

  const adminEmailRaw = process.env.OPENBUCKET_ADMIN_EMAIL?.trim().toLowerCase() || null;
  const adminPasswordRaw = process.env.OPENBUCKET_ADMIN_PASSWORD;
  let adminEmail: string | null = null;
  let adminPassword: Buffer | null = null;
  if (adminEmailRaw || adminPasswordRaw) {
    if (!adminEmailRaw || !adminPasswordRaw) {
      configurationError(
        "AUTH_CONFIG_ADMIN_CREDENTIALS_INCOMPLETE",
        "OPENBUCKET_ADMIN_EMAIL and OPENBUCKET_ADMIN_PASSWORD must both be set to enable the environment-based admin account.",
      );
    }
    if (adminPasswordRaw.length < 12) {
      configurationError("AUTH_CONFIG_ADMIN_PASSWORD_TOO_SHORT", "OPENBUCKET_ADMIN_PASSWORD must contain at least 12 characters.");
    }
    adminEmail = adminEmailRaw;
    adminPassword = Buffer.from(adminPasswordRaw, "utf8");
  }

  const googleClientId = process.env.OPENBUCKET_GOOGLE_CLIENT_ID?.trim() || null;
  const googleClientSecret = process.env.OPENBUCKET_GOOGLE_CLIENT_SECRET?.trim() || null;

  return {
    mongodbUri,
    database,
    authSecret,
    allowSignup,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
    adminEmail,
    adminPassword,
    googleClientId: googleClientId && googleClientSecret ? googleClientId : null,
    googleClientSecret: googleClientId && googleClientSecret ? googleClientSecret : null,
  };
}
