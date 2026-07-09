import { google } from "googleapis";
import { Readable } from "stream";

/** Google Drive access via a service account (not per-user OAuth) — the app
 * uploads on behalf of the firm, so one shared identity is simpler and more
 * reliable than managing individual user consent/refresh tokens.
 *
 * Requires two Railway environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *
 * The service account's email must be shared (as Editor) on the root Drive
 * folder that contains the clients' folders, or on each folder individually.
 */

export function isDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}

function getAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  // Railway env vars are single-line, so the key's real newlines arrive as
  // literal "\n" — convert them back before handing to the JWT client.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

function getDriveClient() {
  const auth = getAuthClient();
  if (!auth) throw new Error("Google Drive no está configurado (faltan las variables de entorno)");
  return google.drive({ version: "v3", auth });
}

/** Pulls the folder ID out of a normal Drive folder URL
 * (e.g. https://drive.google.com/drive/folders/1AbC2dEfG...) */
export function extractFolderIdFromUrl(url: string): string | null {
  if (!url) return null;
  const foldersMatch = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (foldersMatch) return foldersMatch[1];
  const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];
  return null;
}

/** Quick connectivity check — confirms the credentials work AND that this
 * specific folder has actually been shared with the service account. */
export async function testFolderAccess(folderId: string) {
  const drive = getDriveClient();
  const res = await drive.files.get({ fileId: folderId, fields: "id, name, mimeType" });
  return res.data;
}

/** Lists the real subfolders inside a client's Drive folder, so the person
 * uploading evidence can pick the actual folder instead of typing a
 * remembered name. */
export async function listSubfolders(folderId: string) {
  const drive = getDriveClient();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    orderBy: "name",
    pageSize: 100,
  });
  return res.data.files || [];
}

/** Uploads a file into a specific Drive folder (a client's folder or one of
 * its subfolders) and returns its id + a link to view it. */
export async function uploadFileToDrive(folderId: string, fileName: string, buffer: Buffer, mimeType: string) {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, name, webViewLink",
  });
  return res.data;
}
