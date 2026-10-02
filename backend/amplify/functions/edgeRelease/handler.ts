// edgeRelease: the edge installer and package for another PC.
//
// Only tenant admins and operators: they are the ones who pair an edge
// (approving its code needs a tenant admin anyway). The links last 15
// minutes and download the files as attachments; the installer checks the
// package against the SHA-256 published here.

import type { AppSyncResolverEvent } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ADMIN_GROUP, claimsOf, tenantsOf } from "../shared/claims";
import { MIN_EDGE_VERSION } from "../edge-shared/http";

const s3 = new S3Client({});
const BUCKET = () => process.env.EDGE_RELEASE_BUCKET!;
const TTL_S = 15 * 60;

interface Release { version: string; name?: string; module?: string; files: Array<{ name: string; sha256: string; size: number }> }

export const handler = async (event: AppSyncResolverEvent<Record<string, never>>) => {
  const { groups } = claimsOf(event.identity);
  if (!groups.includes(ADMIN_GROUP) && !tenantsOf(groups).length) {
    throw new Error("Only a tenant's admins (or an operator) install edges.");
  }
  const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET(), Key: "release.json" }));
  const release = JSON.parse(await got.Body!.transformToString()) as Release;
  const files = await Promise.all(release.files.map(async (f) => ({
    ...f,
    url: await getSignedUrl(s3, new GetObjectCommand({
      Bucket: BUCKET(), Key: f.name,
      ResponseContentDisposition: `attachment; filename="${f.name}"`,
    }), { expiresIn: TTL_S }),
  })));
  // an object, not a string: AppSync would encode AWSJSON twice
  return {
    version: release.version,
    name: release.name,
    module: release.module,
    minVersion: MIN_EDGE_VERSION,
    files,
    expiresAt: new Date(Date.now() + TTL_S * 1000).toISOString(),
  };
};
