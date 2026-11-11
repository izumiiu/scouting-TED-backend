import mongoose from "mongoose";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
export function bucket() {
  if (!mongoose.connection.db) throw new Error("Database unavailable");
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "tedFiles",
  });
}
export async function storeFile(buffer: Buffer, name: string, mime: string) {
  const stream = bucket().openUploadStream(name, { metadata: { mime } });
  try {
    await pipeline(Readable.from([buffer]), stream);
    return stream.id;
  } catch (error) {
    await bucket()
      .delete(stream.id)
      .catch(() => {});
    throw error;
  }
}
export async function readFile(id: mongoose.Types.ObjectId) {
  const chunks: Buffer[] = [];
  for await (const chunk of bucket().openDownloadStream(id))
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
