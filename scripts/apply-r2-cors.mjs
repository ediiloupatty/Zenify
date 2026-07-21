// Apply the R2 bucket CORS policy needed for direct browser->R2 uploads.
//
// The admin uploader PUTs audio straight to R2 via a presigned URL (to dodge
// Vercel's ~4.5MB Server Action body limit). The browser only allows that if the
// bucket returns CORS headers for PUT from our origin — otherwise the preflight
// fails with "No 'Access-Control-Allow-Origin' header". This sets that policy
// using the R2 S3 API with the credentials already in .env (no wrangler login
// needed). Idempotent: re-running just overwrites with the same rules.
//
// Run:  node scripts/apply-r2-cors.mjs
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

// Standalone scripts don't get Next's automatic .env loading, so parse it here.
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const Bucket = env.R2_BUCKET_NAME || "music";
const client = new S3Client({
  region: "auto",
  endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const CORSRules = [
  {
    AllowedOrigins: ["https://www.zenify.cc", "https://zenify.cc", "http://localhost:3000"],
    AllowedMethods: ["GET", "PUT", "HEAD"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules } }));
console.log(`CORS applied to bucket "${Bucket}".`);

const got = await client.send(new GetBucketCorsCommand({ Bucket }));
console.log("Current rules:", JSON.stringify(got.CORSRules, null, 2));
