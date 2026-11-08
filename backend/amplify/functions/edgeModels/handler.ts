// The files an edge cannot get anywhere public: models/<set>/manifest.json
// lists them ({files: [{name, sha256, size}]}), this hands out 15-minute
// links. Only to a linked edge of the current version, like every edge route.
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { extractBearer, json, parseJsonBody, versionGate } from "../edge-shared/http";
import { verifyDeviceToken } from "../edge-shared/registry";

const s3 = new S3Client({});
const BUCKET = () => process.env.EDGE_RELEASE_BUCKET!;
const TTL_S = 15 * 60;
export const SET = /^[a-z0-9-]{1,40}$/;

interface Manifest { files: Array<{ name: string; sha256: string; size: number }> }

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tooOld = versionGate(event);
  if (tooOld) return tooOld;
  const verified = await verifyDeviceToken(extractBearer(event));
  if (!verified.ok) {
    return verified.reason === "revoked" ? json(410, { error: "revoked" }) : json(401, { error: "invalid_token" });
  }
  const set = String(parseJsonBody<{ set?: string }>(event)?.set || "");
  if (!SET.test(set)) return json(400, { error: "bad_request", message: "set must be a model set name, e.g. faces" });
  let manifest: Manifest;
  try {
    const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: `models/${set}/manifest.json` }));
    manifest = JSON.parse(await got.Body!.transformToString()) as Manifest;
  } catch {
    return json(404, { error: "no_models", message: `this site offers no ${set} models` });
  }
  // a manifest is ours, but a name must still not leave models/<set>/
  if (manifest.files.some((f) => !/^[A-Za-z0-9._-]+$/.test(f.name) || f.name.startsWith("."))) {
    console.error("refusing a manifest with a bad file name", set);
    return json(500, { error: "bad_manifest" });
  }
  const files = await Promise.all(manifest.files.map(async (f) => ({
    ...f,
    url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET(), Key: `models/${set}/${f.name}` }), { expiresIn: TTL_S }),
  })));
  return json(200, { set, files });
};
