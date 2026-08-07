#!/usr/bin/env node
// One-off migration: sets `routeSlug` on every node document that predates the routeSlug field
// (server/control-plane/database.ts). routeSlug is the unique identifier used for public routing
// at openbucket.zydcode.in/api/<routeSlug> and /s3/<routeSlug> — `name` stays as a non-unique
// display label going forward.
//
// Since `name` was itself uniquely indexed before this change, every pre-existing node's name is
// already guaranteed unique across the whole collection, so routeSlug = name is a safe, collision-
// free backfill for legacy documents. Run it with your own MONGODB_URI:
//
//   MONGODB_URI="mongodb+srv://..." node scripts/backfill-route-slug.mjs

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
  const nodes = db.collection("nodes");

  const missing = await nodes.countDocuments({ routeSlug: { $exists: false } });
  console.log(`Nodes missing routeSlug: ${missing}`);
  if (missing === 0) {
    console.log("Nothing to do.");
  } else {
    const cursor = nodes.find({ routeSlug: { $exists: false } }, { projection: { name: 1 } });
    let updated = 0;
    for await (const node of cursor) {
      await nodes.updateOne({ _id: node._id }, { $set: { routeSlug: node.name } });
      updated += 1;
    }
    console.log(`Backfilled routeSlug on ${updated} node document(s).`);
  }

  const stillMissing = await nodes.countDocuments({ routeSlug: { $exists: false } });
  if (stillMissing > 0) {
    console.error(`${stillMissing} node document(s) still missing routeSlug after backfill — investigate before relying on the unique index.`);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
