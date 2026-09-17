import { apiMessage } from '../services/api';

// Axios error responses arrive as a Blob (not parsed JSON) when the request was
// made with responseType: 'blob' — unwrap it to get the real server message
// (e.g. the 429 rate-limit text) instead of a generic fallback.
export async function blobErrorMessage(err, fallback) {
  const blob = err?.response?.data;
  if (blob instanceof Blob && blob.type.includes('json')) {
    try {
      const parsed = JSON.parse(await blob.text());
      return parsed.message || fallback;
    } catch {
      return fallback;
    }
  }
  return apiMessage(err, fallback);
}