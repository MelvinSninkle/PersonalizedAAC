// Shared private-Blob helpers. Reading a stored blob into a Buffer (with its
// content type) and uploading bytes to a `${kind}/${uuid}.${ext}` key were each
// re-implemented across several endpoints; these are the single copies for the
// non-render paths. (The keystone render path keeps its own reader in
// onboarding-render.js to avoid importing the heavy render module here.)
import { put, get } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

export async function readBlobBytes(key) {
  const result = await get(key, { access: 'private' });
  if (result.statusCode !== 200 || !result.stream) throw new Error('blob read failed');
  const reader = result.stream.getReader();
  const chunks = [];
  while (true) { const { value, done } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  return { buffer: Buffer.concat(chunks), contentType: result.blob.contentType || 'image/jpeg' };
}

// Upload bytes to a private `${kind}/${uuid}.${ext}` key; returns the key.
export async function uploadBytes(kind, ext, buffer, contentType) {
  const pathname = `${kind}/${randomUUID()}.${ext}`;
  await put(pathname, buffer, { access: 'private', contentType, addRandomSuffix: false });
  return pathname;
}
