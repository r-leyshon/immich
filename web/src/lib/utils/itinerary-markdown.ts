export type ItineraryStop = {
  name: string;
  query: string;
  lat?: number;
  lon?: number;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

export type ItineraryBlock =
  | { type: 'html'; html: string }
  | { type: 'map'; name: string; query: string }
  | { type: 'image'; alt: string; fileName?: string; src?: string };

export type ParsedItinerary = {
  title: string;
  blocks: ItineraryBlock[];
  stops: ItineraryStop[];
};

const MAPS_QUERY_RE = /[?&]q=([^&]+)/i;

const TOKEN_RE =
  /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:<\/iframe>)?|<div\b[^>]*\bdata-itinerary-map=["']([^"']+)["'][^>]*>[\s\S]*?<\/div>|<img\b[^>]*>|!\[\[([^\]]+)]]|!\[([^\]]*)]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+|[^)\n]+)\)/gi;

const decodeMapsValue = (value: string) => decodeURIComponent(value.replaceAll('+', ' ')).trim();

export const isHtmlDocument = (content: string) => /<!doctype html|<html[\s>]/i.test(content);

export const isItineraryAsset = (asset: { originalFileName?: string | null; type?: string | null }) => {
  if (asset.type === 'OTHER') {
    return true;
  }
  const name = asset.originalFileName?.toLowerCase() ?? '';
  return name.endsWith('.md') || name.endsWith('.html') || name.endsWith('.htm');
};

export const isMarkdownAsset = isItineraryAsset;

export const googleMapsEmbedSrc = (query: string) =>
  `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed&z=14`;

export const basenameFromEmbed = (src: string) => {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('data:')) {
    return '';
  }

  const file = trimmed.split(/[?#]/)[0].split(/[/\\]/).pop() ?? trimmed;
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
};

export const extractItineraryTitle = (content: string, fileName: string) => {
  const htmlTitle = content.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  if (htmlTitle) {
    return htmlTitle.replaceAll(/[\u{1F300}-\u{1FAFF}]/gu, '').trim() || htmlTitle;
  }

  const fromFile = fileName
    .replace(/\.(md|html|htm)$/i, '')
    .replaceAll(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .trim();
  return fromFile || 'Itinerary';
};

export const stripItineraryFrontmatter = (markdown: string) => {
  if (!markdown.startsWith('---')) {
    return markdown;
  }
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) {
    return markdown;
  }
  return markdown.slice(end + 4).replace(/^\n/, '');
};

export const extractHtmlBody = (html: string) => {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  return body.replace(/<header\b[\s\S]*?<\/header>/i, '');
};

export const extractItineraryStops = (markdown: string): ItineraryStop[] => {
  const stops: ItineraryStop[] = [];
  const seen = new Set<string>();

  const add = (query: string) => {
    const name = decodeMapsValue(query);
    if (!name || seen.has(name.toLowerCase())) {
      return;
    }
    seen.add(name.toLowerCase());
    stops.push({ name, query: name });
  };

  const iframeRe = /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>(?:<\/iframe>)?/gi;
  const dirRe = /google\.[^/\s"'<>]+\/maps\/dir\/([^?\s"'<>)]+)/gi;
  const mapAttrRe = /data-itinerary-map=["']([^"']+)["']/gi;

  for (const match of markdown.matchAll(iframeRe)) {
    const query = match[1].match(MAPS_QUERY_RE)?.[1];
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

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const inlineMarkdown = (value: string) => {
  const escaped = escapeHtml(value);
  return escaped
    .replaceAll(/\[([^\]]+)]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
    .replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replaceAll(/\*([^*]+)\*/g, '<em>$1</em>');
};

export const renderItineraryMarkdown = (markdown: string) => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    if (trimmed.startsWith('<iframe') || trimmed.startsWith('<img') || trimmed.startsWith('<div')) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      closeList();
      html.push('<hr />');
      continue;
    }

    if (trimmed.startsWith('> ')) {
      closeList();
      html.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const checklist = trimmed.match(/^[-*]\s+\[([ xX])]\s+(.+)$/);
    if (checklist) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul class="itinerary-checklist">');
        listType = 'ul';
      }
      const checked = checklist[1].toLowerCase() === 'x';
      html.push(
        `<li><label><input type="checkbox" disabled ${checked ? 'checked' : ''} /> ${inlineMarkdown(checklist[2])}</label></li>`,
      );
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  closeList();
  return html.join('\n');
};

const stripScriptsAndStyles = (html: string) =>
  html
    .replaceAll(/<script\b[\s\S]*?<\/script>/gi, '')
    .replaceAll(/<style\b[\s\S]*?<\/style>/gi, '')
    .replaceAll(/<link\b[^>]*>/gi, '')
    .replaceAll(/<\/?article\b[^>]*>/gi, '')
    .replaceAll(/<div\b[^>]*\bid=["']overview-map["'][^>]*>[\s\S]*?<\/div>/gi, '')
    .replaceAll(/\son\w+\s*=\s*(['"]).*?\1/gi, '');

const sanitizeItineraryHtml = (html: string) => stripScriptsAndStyles(html);

const parseImgTag = (tag: string): ItineraryBlock | null => {
  const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (!src) {
    return null;
  }
  const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] ?? '';
  if (src.startsWith('data:image/')) {
    return { type: 'image', alt: alt || 'Image', src };
  }
  const fileName = basenameFromEmbed(src);
  return { type: 'image', alt: alt || fileName, fileName };
};

const pushTextBlock = (blocks: ItineraryBlock[], text: string, htmlDoc: boolean) => {
  if (!text) {
    return;
  }

  if (htmlDoc) {
    const html = sanitizeItineraryHtml(text);
    if (!html.replaceAll(/<!--[\s\S]*?-->/g, '').trim()) {
      return;
    }
    blocks.push({ type: 'html', html });
    return;
  }

  const html = renderItineraryMarkdown(text);
  if (html.trim()) {
    blocks.push({ type: 'html', html });
  }
};

export const parseItinerary = (content: string, fileName: string): ParsedItinerary => {
  const title = extractItineraryTitle(content, fileName);
  const stops = extractItineraryStops(content);
  const htmlDoc = isHtmlDocument(content);
  const body = htmlDoc ? stripScriptsAndStyles(extractHtmlBody(content)) : stripItineraryFrontmatter(content);
  const blocks: ItineraryBlock[] = [];
  const tokenRe = new RegExp(TOKEN_RE.source, 'gi');
  let lastIndex = 0;

  for (const match of body.matchAll(tokenRe)) {
    pushTextBlock(blocks, body.slice(lastIndex, match.index), htmlDoc);
    lastIndex = (match.index ?? 0) + match[0].length;

    const iframeSrc = match[1];
    const dataMap = match[2];
    const wikiFile = match[3];
    const mdAlt = match[4];
    const mdSrc = match[5];

    if (iframeSrc) {
      const query = iframeSrc.match(MAPS_QUERY_RE)?.[1];
      if (query) {
        const name = decodeMapsValue(query);
        blocks.push({ type: 'map', name, query: name });
      }
      continue;
    }

    if (dataMap) {
      const name = decodeMapsValue(dataMap);
      blocks.push({ type: 'map', name, query: name });
      continue;
    }

    if (wikiFile) {
      const embedded = basenameFromEmbed(wikiFile.split('|')[0]);
      blocks.push({ type: 'image', fileName: embedded, alt: embedded.replace(/\.[^.]+$/, '') });
      continue;
    }

    if (mdSrc) {
      if (mdSrc.startsWith('data:image/')) {
        blocks.push({ type: 'image', alt: mdAlt || 'Image', src: mdSrc });
      } else {
        const embedded = basenameFromEmbed(mdSrc);
        blocks.push({ type: 'image', fileName: embedded, alt: mdAlt || embedded });
      }
      continue;
    }

    if (match[0].startsWith('<img')) {
      const image = parseImgTag(match[0]);
      if (image) {
        blocks.push(image);
      }
    }
  }

  pushTextBlock(blocks, body.slice(lastIndex), htmlDoc);
  return { title, blocks, stops };
};

export const mergeGeocodedStops = (stops: ItineraryStop[], geocoded: ItineraryStop[]) => {
  const byName = new Map(geocoded.map((stop) => [stop.name.toLowerCase(), stop] as const));
  return stops.map((stop) => byName.get(stop.name.toLowerCase()) ?? stop);
};
