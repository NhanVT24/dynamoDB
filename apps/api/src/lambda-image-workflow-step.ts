import "reflect-metadata";

type ImageWorkflowInput = {
  Records?: Array<{
    eventName?: string;
    eventTime?: string;
    s3?: {
      bucket?: { name?: string };
      object?: { key?: string; size?: number };
    };
  }>;
};

function buildPublicUrl(bucket: string, objectKey: string, region: string) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;
}

export const handler = async (event: ImageWorkflowInput) => {
  const records = Array.isArray(event.Records) ? event.Records : [];
  const items = records.map((record) => {
    const bucket = String(record.s3?.bucket?.name ?? "");
    const encodedKey = String(record.s3?.object?.key ?? "");
    const key = decodeURIComponent(encodedKey.replaceAll("+", " "));
    const scope = key.split("/")[0] ?? "";

    return {
      bucket,
      key,
      scope,
      size: Number(record.s3?.object?.size ?? 0),
      eventName: String(record.eventName ?? ""),
      uploadedAt: String(record.eventTime ?? ""),
      fileUrl: bucket && key ? buildPublicUrl(bucket, key, process.env.AWS_REGION ?? "ap-southeast-1") : ""
    };
  });

  console.log("[workflow-image] processed", JSON.stringify(items));
  return {
    processed: items.length,
    items
  };
};
