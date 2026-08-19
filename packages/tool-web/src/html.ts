const BLOCK_TAGS = /<(script|style|noscript|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const BLOCK_CLOSE = /<\/(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|pre|ul|ol|table)>/gi;
const BR = /<br\s*\/?>/gi;
const HR = /<hr\s*\/?>/gi;
const TAG = /<[^>]+>/g;
const ENTITY = /&(#x?[0-9a-f]+|[a-z]+);/gi;

const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string): string {
  let text = html.replace(BLOCK_TAGS, " ");
  text = text.replace(COMMENT, " ");
  text = text.replace(BR, "\n");
  text = text.replace(HR, "\n");
  text = text.replace(BLOCK_CLOSE, "\n");
  text = text.replace(TAG, " ");
  text = decodeEntities(text);
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");
  return text.trim();
}

export function decodeEntities(value: string): string {
  return value.replace(ENTITY, (_, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return NAMED[lower] ?? "";
  });
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) {
    return true;
  }
  let control = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) {
      control += 1;
    }
  }
  return sample.length > 0 && control / sample.length > 0.1;
}

export function isHtmlContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) {
    return false;
  }
  return contentType.toLowerCase().includes("text/html");
}

export function isRejectedContentType(contentType: string | undefined): boolean {
  if (contentType === undefined || contentType.length === 0) {
    return false;
  }
  const type = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (type.startsWith("text/")) {
    return false;
  }
  if (
    type === "application/json" ||
    type === "application/ld+json" ||
    type === "application/xml" ||
    type === "application/javascript" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  ) {
    return false;
  }
  return (
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    type.startsWith("font/") ||
    type === "application/octet-stream" ||
    type === "application/pdf" ||
    type === "application/zip" ||
    type === "application/gzip" ||
    type === "application/wasm"
  );
}
