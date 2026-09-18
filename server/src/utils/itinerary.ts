export const ITINERARY_METADATA_KEY = 'itinerary';

export type ItineraryStop = {
  name: string;
  query: string;
};

export type GeocodedItineraryStop = ItineraryStop & {
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  country: string | null;
};

export type ItineraryMetadata = {
  title: string;
  stops: GeocodedItineraryStop[];
};

const decodeMapsValue = (value: string) => decodeURIComponent(value.replaceAll('+', ' ')).trim();

export const extractItineraryTitle = (markdown: string, fallbackFileName: string) => {
  const htmlTitle = markdown.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  if (htmlTitle) {
    return htmlTitle.replaceAll(/[\u{1F300}-\u{1FAFF}]/gu, '').trim() || htmlTitle;
  }

  const fromFile = fallbackFileName
    .replace(/\.(md|html|htm)$/i, '')
    .replaceAll(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .trim();
  if (fromFile) {
    return fromFile;
  }

  const heading = markdown.match(/^#{1,2}\s+(.+)$/m)?.[1];
  return heading?.replaceAll(/[\u{1F300}-\u{1FAFF}]/gu, '').trim() || 'Itinerary';
};

export const parseItineraryFrontmatter = (markdown: string) => {
  if (/<!doctype html|<html[\s>]/i.test(markdown)) {
    const created = markdown.match(/<meta\s+name=["']created["']\s+content=["']([^"']+)["']/i)?.[1]?.trim();
    const tags =
      markdown
        .match(/<meta\s+name=["']tags["']\s+content=["']([^"']+)["']/i)?.[1]
        ?.split(',')
        .map((tag) => tag.trim())
        .filter(Boolean) ?? [];
    return { tags, created, body: markdown };
  }

  if (!markdown.startsWith('---')) {
    return { tags: [] as string[], created: undefined as string | undefined, body: markdown };
  }

  const end = markdown.indexOf('\n---', 3);
  if (end === -1) {
    return { tags: [] as string[], created: undefined as string | undefined, body: markdown };
  }

  const yaml = markdown.slice(4, end);
  const body = markdown.slice(end + 4).replace(/^\n/, '');
  const tags: string[] = [];
  let inTags = false;
  let created: string | undefined;

  for (const line of yaml.split('\n')) {
    if (/^tags:\s*$/.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) {
        tags.push(item[1].trim());
        continue;
      }
      inTags = false;
    }
    const createdMatch = line.match(/^created:\s*(.+)$/);
    if (createdMatch) {
      created = createdMatch[1].trim();
    }
  }

  return { tags, created, body };
};

export const extractItineraryStops = (markdown: string): ItineraryStop[] => {
  const stops: ItineraryStop[] = [];
  const seen = new Set<string>();
  const iframeRe = /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const dirRe = /google\.[^/\s"'<>]+\/maps\/dir\/([^?\s"'<>)]+)/gi;
  const mapAttrRe = /data-itinerary-map=["']([^"']+)["']/gi;

  const add = (query: string) => {
    const name = decodeMapsValue(query);
    if (!name || seen.has(name.toLowerCase())) {
      return;
    }
    seen.add(name.toLowerCase());
    stops.push({ name, query: name });
  };

  for (const match of markdown.matchAll(iframeRe)) {
    const query = match[1].match(/[?&]q=([^&]+)/i)?.[1];
    if (query) {
      add(query);
    }
  }

  for (const match of markdown.matchAll(mapAttrRe)) {
    add(match[1]);
  }

  for (const match of markdown.matchAll(dirRe)) {
    for (const part of match[1].split('/')) {
      add(part);
    }
  }

  return stops;
};

const DATA_URI_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)/;

export const extractDocumentPreviewImage = (content: string): Buffer | null => {
  const match = content.match(DATA_URI_RE);
  if (!match) {
    return null;
  }

  try {
    const buffer = Buffer.from(match[1].replaceAll(/\s/g, ''), 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
};

const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export const documentPreviewSvg = (title: string) => {
  const label = escapeXml(title.slice(0, 48) || 'Document');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
  <rect width="900" height="900" fill="#e8eef7"/>
  <g transform="translate(210 150) scale(20)">
    <path fill="#4250af" d="M6,2A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6M6,4H13V9H18V20H6V4M8,12V14H16V12H8M8,16V18H13V16H8Z"/>
  </g>
  <text x="450" y="780" text-anchor="middle" font-size="36" font-family="sans-serif" fill="#4250af">${label}</text>
</svg>`;
};
