import { ObjectId, type Collection, type Db } from "mongodb";
import { getAuthDatabaseContext } from "../auth/database.js";

export type SupportKind = "feedback" | "bug" | "help";
export type SupportSeverity = "low" | "medium" | "high" | "critical";
export type SupportStatus = "new" | "reviewed" | "resolved";

export type SupportSubmissionDocument = {
  _id: ObjectId;
  kind: SupportKind;
  status: SupportStatus;
  message: string;
  /** Bug reports only. */
  title: string | null;
  stepsToReproduce: string | null;
  severity: SupportSeverity | null;
  email: string | null;
  name: string | null;
  path: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SupportCollections = {
  submissions: Collection<SupportSubmissionDocument>;
};

type SupportIndexState = { indexPromise: Promise<void> | null };
const globalSupport = globalThis as typeof globalThis & { __openbucketSupport?: SupportIndexState };
const indexState = globalSupport.__openbucketSupport ?? { indexPromise: null };
globalSupport.__openbucketSupport = indexState;

async function ensureSupportIndexes(database: Db): Promise<void> {
  if (!indexState.indexPromise) {
    indexState.indexPromise = Promise.all([
      database.collection<SupportSubmissionDocument>("support_submissions").createIndex(
        { kind: 1, status: 1, createdAt: -1 },
        { name: "support_kind_status_created" },
      ),
    ]).then(() => undefined);
    indexState.indexPromise.catch(() => { indexState.indexPromise = null; });
  }
  await indexState.indexPromise;
}

export async function getSupportCollections(): Promise<SupportCollections> {
  const { database } = await getAuthDatabaseContext();
  await ensureSupportIndexes(database);
  return { submissions: database.collection<SupportSubmissionDocument>("support_submissions") };
}

export function resetSupportIndexesForTests(): void {
  indexState.indexPromise = null;
}
