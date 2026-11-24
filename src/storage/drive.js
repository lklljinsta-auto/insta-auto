// Google Drive v3. Persist every generated ID before calling create with it.
import { open } from 'node:fs/promises';

const api = 'https://www.googleapis.com/drive/v3';
const upload = 'https://www.googleapis.com/upload/drive/v3';
const folderMime = 'application/vnd.google-apps.folder';
const fields = 'id,name,parents,mimeType,size,sha256Checksum,trashed,appProperties';
const chunkSize = 8 * 1024 * 1024;

export function driveConfig(env = process.env) {
  const rootId = env.GOOGLE_DRIVE_ROOT_ID;
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { rootId, clientId, clientSecret, refreshToken };
}

function failure(code) {
  return Object.assign(new Error(code), { code });
}

export class GoogleDrive {
  constructor(config, request = fetch) {
    this.config = config;
    this.rootId = config.rootId;
    this.request = request;
  }
  async token() {
    if (this.tokenValue && Date.now() < this.tokenUntil) return this.tokenValue;
    const { clientId, clientSecret, refreshToken } = this.config;
    const r = await this.request('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token' })
    });
    if (!r.ok) throw failure('drive_oauth_' + r.status);
    const data = await r.json();
    if (!data.access_token) throw failure('drive_token_missing');
    this.tokenValue = data.access_token;
    this.tokenUntil = Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000;
    return this.tokenValue;
  }
  async call(url, init = {}) {
    const response = await this.request(url, {
      ...init, redirect: 'manual', signal: AbortSignal.timeout(90000),
      headers: { ...init.headers, Authorization: 'Bearer ' + await this.token() }
    });
    if (response.status === 401) this.tokenValue = null;
    return response;
  }
  async allocateId() {
    const r = await this.call(api + '/files/generateIds?count=1&space=drive');
    if (!r.ok) throw failure('drive_ids_' + r.status);
    const { ids } = await r.json();
    if (!ids?.[0]) throw failure('drive_id_missing');
    return ids[0];
  }
  async stat(id) {
    const r = await this.call(api + '/files/' + encodeURIComponent(id) +
      '?supportsAllDrives=true&fields=' + fields);
    if (r.status === 404) return null;
    if (!r.ok) throw failure('drive_read_' + r.status);
    return r.json();
  }
  verify(meta, expected, file) {
    if (!meta || meta.id !== expected.id || meta.trashed || meta.mimeType !== expected.mimeType ||
        !meta.parents?.includes(expected.parents[0]) ||
        meta.appProperties?.instaauto !== expected.appProperties.instaauto)
      throw failure('drive_object_mismatch');
    if (file && (Number(meta.size) !== file.size || meta.sha256Checksum !== file.sha256))
      throw failure('drive_checksum_mismatch');
  }
  async ensureFolder(id, parent, name, owner) {
    const meta = { id, name, parents: [parent], mimeType: folderMime, appProperties: { instaauto: owner } };
    let found = await this.stat(id);
    if (!found) {
      const r = await this.call(api + '/files?supportsAllDrives=true&fields=' + fields, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta)
      });
      if (!r.ok && r.status !== 409) throw failure('drive_folder_' + r.status);
      found = r.ok ? await r.json() : await this.stat(id);
    }
    this.verify(found, meta);
  }
  async ensureFile(id, parent, file, beforeWrite = async () => {}) {
    const meta = { id, name: file.name, mimeType: file.mime, parents: [parent],
      appProperties: { instaauto: file.assetId } };
    const existing = await this.stat(id);
    if (existing) { this.verify(existing, meta, file); return; }
    await beforeWrite();
    const start = await this.call(upload + '/files?uploadType=resumable&supportsAllDrives=true&fields=' + fields, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Upload-Content-Type': file.mime, 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify(meta)
    });
    if (start.status === 409) { this.verify(await this.stat(id), meta, file); return; }
    if (!start.ok) throw failure('drive_upload_start_' + start.status);
    const location = new URL(start.headers.get('location') || '', upload);
    if (!start.headers.has('location') || location.protocol !== 'https:' ||
        !(location.hostname === 'www.googleapis.com' || location.hostname.endsWith('.googleapis.com')))
      throw failure('drive_upload_location');
    const input = await open(file.path, 'r');
    try {
      let offset = 0;
      while (offset < file.size) {
        const length = Math.min(chunkSize, file.size - offset);
        const bytes = Buffer.alloc(length);
        const read = await input.read(bytes, 0, length, offset);
        if (read.bytesRead !== length) throw failure('archive_staged_file_incomplete');
        await beforeWrite();
        const r = await this.call(location, { method: 'PUT', headers: {
          'Content-Type': file.mime, 'Content-Length': String(length),
          'Content-Range': 'bytes ' + offset + '-' + (offset + length - 1) + '/' + file.size
        }, body: bytes });
        if (r.ok) { this.verify(await r.json(), meta, file); return; }
        if (r.status === 409) { this.verify(await this.stat(id), meta, file); return; }
        if (r.status !== 308) throw failure('drive_upload_' + r.status);
        const range = /^bytes=0-(\d+)$/.exec(r.headers.get('range') || '');
        const next = range ? Number(range[1]) + 1 : 0;
        if (next <= offset || next > offset + length) throw failure('drive_upload_range');
        offset = next;
      }
      this.verify(await this.stat(id), meta, file);
    } finally { await input.close(); }
  }
}
