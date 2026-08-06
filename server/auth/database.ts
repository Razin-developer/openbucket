import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import { getAuthConfig } from "./config.js";

export type UserDocument = {
  _id: ObjectId;
  email: string;
  emailNormalized: string;
  name: string | null;
  /** Immutable public handle used in safe node discovery URLs. */
  handle?: string;
  /** Absent for accounts created through Google sign-in that never set a password. */
  passwordHash?: string;
  /** Subject id from Google's ID token, when the account is linked to Google sign-in. */
  googleId?: string;
  /** @deprecated Admin is now determined solely by OPENBUCKET_ADMIN_EMAIL/OPENBUCKET_ADMIN_PASSWORD; ignored at runtime. */
  role?: "admin" | "member";
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
};

export type SessionDocument = {
  _id: string;
  /** Null for the environment-configured admin account, which has no user document. */
  userId: ObjectId | null;
  isEnvAdmin?: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ipHash: string;
  userAgentHash: string;
};

export type RateLimitDocument = {
  _id: string;
  count: number;
  createdAt: Date;
  expiresAt: Date;
};

export type PasswordResetDocument = {
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
};

export type AuthCollections = {
  users: Collection<UserDocument>;
  sessions: Collection<SessionDocument>;
  rateLimits: Collection<RateLimitDocument>;
  passwordResets: Collection<PasswordResetDocument>;
};

type MongoState = {
  uri?: string;
  client?: MongoClient;
  clientPromise?: Promise<MongoClient>;
  indexPromises: Map<string, Promise<void>>;
};

const globalMongo = globalThis as typeof globalThis & { __openbucketAuthMongo?: MongoState };
const mongoState = globalMongo.__openbucketAuthMongo ?? { indexPromises: new Map<string, Promise<void>>() };
globalMongo.__openbucketAuthMongo = mongoState;

async function getClient(): Promise<MongoClient> {
  const { mongodbUri } = getAuthConfig();
  if (mongoState.uri && mongoState.uri !== mongodbUri) {
    throw new Error("MONGODB_URI changed while the authentication process was running.");
  }
  if (!mongoState.clientPromise) {
    const client = new MongoClient(mongodbUri, {
      appName: "openbucket-web",
      maxPoolSize: 10,
      minPoolSize: 0,
      maxConnecting: 2,
      maxIdleTimeMS: 60_000,
      waitQueueTimeoutMS: 5_000,
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 10_000,
      retryReads: true,
      socketTimeoutMS: 15_000,
      timeoutMS: 10_000,
      readPreference: "primary",
      readConcern: { level: "majority" },
      writeConcern: { w: "majority", wtimeoutMS: 5_000 },
      retryWrites: true,
    });
    mongoState.uri = mongodbUri;
    mongoState.client = client;
    mongoState.clientPromise = client.connect().catch((error) => {
      mongoState.client = undefined;
      mongoState.clientPromise = undefined;
      mongoState.uri = undefined;
      throw error;
    });
  }
  return mongoState.clientPromise;
}

async function ensureIndexes(database: Db): Promise<void> {
  const key = database.databaseName;
  let pending = mongoState.indexPromises.get(key);
  if (!pending) {
    pending = Promise.all([
      database.collection<UserDocument>("users").createIndex(
        { emailNormalized: 1 },
        { name: "users_email_normalized_unique", unique: true },
      ),
      database.collection<UserDocument>("users").createIndex(
        { handle: 1 },
        { name: "users_handle_unique", unique: true, sparse: true },
      ),
      database.collection<UserDocument>("users").createIndex(
        { googleId: 1 },
        { name: "users_google_id_unique", unique: true, sparse: true },
      ),
      database.collection<SessionDocument>("sessions").createIndex(
        { expiresAt: 1 },
        { name: "sessions_expiry_ttl", expireAfterSeconds: 0 },
      ),
      database.collection<SessionDocument>("sessions").createIndex(
        { userId: 1, expiresAt: -1 },
        { name: "sessions_user_expiry" },
      ),
      database.collection<RateLimitDocument>("auth_rate_limits").createIndex(
        { expiresAt: 1 },
        { name: "auth_rate_limits_expiry_ttl", expireAfterSeconds: 0 },
      ),
      database.collection<PasswordResetDocument>("password_resets").createIndex(
        { expiresAt: 1 },
        { name: "password_resets_expiry_ttl", expireAfterSeconds: 0 },
      ),
      database.collection<PasswordResetDocument>("password_resets").createIndex(
        { userId: 1 },
        { name: "password_resets_user" },
      ),
    ]).then(() => undefined);
    mongoState.indexPromises.set(key, pending);
    pending.catch(() => mongoState.indexPromises.delete(key));
  }
  await pending;
}

export async function getAuthDatabaseContext(): Promise<{ client: MongoClient; database: Db }> {
  const config = getAuthConfig();
  const client = await getClient();
  const database = client.db(config.database);
  await ensureIndexes(database);
  return { client, database };
}

export async function getAuthCollections(): Promise<AuthCollections> {
  const { database } = await getAuthDatabaseContext();
  return {
    users: database.collection<UserDocument>("users"),
    sessions: database.collection<SessionDocument>("sessions"),
    rateLimits: database.collection<RateLimitDocument>("auth_rate_limits"),
    passwordResets: database.collection<PasswordResetDocument>("password_resets"),
  };
}

export async function closeAuthDatabaseForTests(): Promise<void> {
  const client = mongoState.client;
  mongoState.client = undefined;
  mongoState.clientPromise = undefined;
  mongoState.uri = undefined;
  mongoState.indexPromises.clear();
  if (client) await client.close();
}
