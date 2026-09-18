import {
  documentPreviewSvg,
  extractDocumentPreviewImage,
  extractItineraryStops,
  extractItineraryTitle,
  parseItineraryFrontmatter,
} from 'src/utils/itinerary.js';

const kosMarkdown = `---
tags:
  - holidays
  - travel
created: 2026-08-19
---
> **Base Camp:** Akti Palace Hotel (Kardamyna)

## 📅 Itinerary Overview

[🗺️ Open Full Family Road Trip Route in Google Maps](https://www.google.com/maps/dir/Akti+Palace+Hotel,+Kardamyna/Roman+Odeon+of+Kos/Asclepieion+of+Kos)

<iframe src="https://maps.google.com/maps?q=Roman+Odeon+of+Kos&t=&z=14&ie=UTF8&iwloc=&output=embed" width="100%" height="300"></iframe>

<iframe src="https://maps.google.com/maps?q=Asclepieion+of+Kos&t=&z=14" width="100%" height="300"></iframe>
`;

describe('itinerary', () => {
  it('should parse frontmatter tags and created date', () => {
    expect(parseItineraryFrontmatter(kosMarkdown)).toEqual({
      tags: ['holidays', 'travel'],
      created: '2026-08-19',
      body: expect.stringContaining('Itinerary Overview'),
    });
  });

  it('should use the markdown filename as the title', () => {
    expect(extractItineraryTitle(kosMarkdown, '🚗 Kos Road Trip Itinerary.md')).toBe('Kos Road Trip Itinerary');
  });

  it('should extract unique map stops in order', () => {
    expect(extractItineraryStops(kosMarkdown).map((stop) => stop.name)).toEqual([
      'Roman Odeon of Kos',
      'Asclepieion of Kos',
      'Akti Palace Hotel, Kardamyna',
    ]);
  });

  it('should parse html itinerary titles, tags, and map attributes', () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Kos Road Trip Itinerary</title>
  <meta name="created" content="2026-08-19">
  <meta name="tags" content="holidays,travel">
</head>
<body>
  <div data-itinerary-map="Roman Odeon of Kos"></div>
</body>
</html>`;

    expect(extractItineraryTitle(html, 'ignored.html')).toBe('Kos Road Trip Itinerary');
    expect(parseItineraryFrontmatter(html)).toEqual({
      tags: ['holidays', 'travel'],
      created: '2026-08-19',
      body: html,
    });
    expect(extractItineraryStops(html).map((stop) => stop.name)).toEqual(['Roman Odeon of Kos']);
  });

  it('should extract the first inlined image as a preview', () => {
    const preview = extractDocumentPreviewImage(
      '<img alt="Roman Odeon" src="data:image/png;base64,aGVsbG8gd29ybGQgcHJldmlldw==">',
    );
    expect(preview?.toString()).toBe('hello world preview');
  });

  it('should not invent a preview image when the document has none', () => {
    expect(extractDocumentPreviewImage('<title>Kos Road Trip</title><p>No photos</p>')).toBeNull();
  });

  it('should render a document-icon fallback preview', () => {
    const svg = documentPreviewSvg('Kos Road Trip');
    expect(svg).toContain('Kos Road Trip');
    expect(svg).toContain('#e8eef7');
    expect(svg).toContain('M6,2A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6');
    expect(documentPreviewSvg('<script>')).toContain('&lt;script&gt;');
  });
});
