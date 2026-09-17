// PDFs and images have something a browser can actually render, so they open in
// a new tab (a phone user tapping a title deed wants to look at it, not file it
// away). Word/Excel files have nothing to render, so they always download.
export function opensInBrowser(mimeType) {
  return String(mimeType).startsWith('image/') || mimeType === 'application/pdf';
}