#!/usr/bin/env node
// One-off maintenance script: clears the legacy `role: "admin"` field left on user documents
// from before admin access moved to OPENBUCKET_ADMIN_EMAIL/OPENBUCKET_ADMIN_PASSWORD, and drops
// the now-unused `auth_controls` collection from the old owner-bootstrap flow.
//
// The application code already ignores the `role` field entirely (see server/auth/service.ts),
// so this script is optional hygiene, not a required security step. Run it with your own
// MONGODB_URI (e.g. `vercel env pull .env.production.local --environment=production` if that
// variable isn't marked sensitive in your Vercel project, or paste it from wherever you store it):
//
//   MONGODB_URI="mongodb+srv://..." node scripts/clear-legacy-admin-role.mjs

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGODB_URI in the environment before running this script.");
  process.exit(1);
}
const dbName = process.env.MONGODB_DATABASE?.trim() || "openbucket_web";

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
await client.connect();
try {
  const db = client.db(dbName);
  const users = db.collection("users");

  const withRole = await users.countDocuments({ role: { $exists: true } });
  console.log(`Users with a legacy role field set: ${withRole}`);
  if (withRole > 0) {
    const result = await users.updateMany({ role: { $exists: true } }, { $unset: { role: "" } });
    console.log(`Cleared role field on ${result.modifiedCount} user document(s).`);
  }

  const authControlsExists = (await db.listCollections({ name: "auth_controls" }).toArray()).length > 0;
  if (authControlsExists) {
    const dropped = await db.collection("auth_controls").countDocuments({});
    await db.collection("auth_controls").drop();
    console.log(`Dropped the now-unused auth_controls collection (had ${dropped} document(s)).`);
  } else {
    console.log("auth_controls collection did not exist.");
  }

  const remaining = await users.countDocuments({});
  console.log(`Total user accounts remaining (untouched): ${remaining}`);
} finally {
  await client.close();
}
