import { extensionOf } from "./paths";

/** Extensions previewed as images. Keep in sync with image_mime in
 *  src-tauri/src/commands/files.rs. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
]);

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

/** Data URL for an `<img src>`. An SVG in an img tag cannot run its scripts. */
export function imageDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}
