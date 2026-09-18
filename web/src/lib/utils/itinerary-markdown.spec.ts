import { googleMapsEmbedSrc, isItineraryAsset, parseItinerary, renderItineraryMarkdown } from './itinerary-markdown';

const sample = `---
tags:
  - holidays
created: 2026-08-19
---
> **Base Camp:** Akti Palace Hotel

## Itinerary Overview

- [ ] Sunscreen
- **09:00 AM** – Departure

[Open route](https://www.google.com/maps/dir/Akti+Palace+Hotel,+Kardamyna/Roman+Odeon+of+Kos)

<iframe src="https://maps.google.com/maps?q=Roman+Odeon+of+Kos&output=embed" width="100%" height="300"></iframe>

![[Pasted image 20260819163135.png]]
`;

describe('itinerary markdown', () => {
  it('parses stops, maps, and rendered copy', () => {
    const parsed = parseItinerary(sample, '🚗 Kos Road Trip Itinerary.md');

    expect(parsed.title).toBe('Kos Road Trip Itinerary');
    expect(parsed.stops.map((stop) => stop.name)).toEqual(['Roman Odeon of Kos', 'Akti Palace Hotel, Kardamyna']);
    expect(parsed.blocks.some((block) => block.type === 'map' && block.name === 'Roman Odeon of Kos')).toBe(true);
    expect(parsed.blocks.some((block) => block.type === 'html' && block.html.includes('Base Camp'))).toBe(true);
    expect(parsed.blocks).toContainEqual({
      type: 'image',
      fileName: 'Pasted image 20260819163135.png',
      alt: 'Pasted image 20260819163135',
    });
  });

  it('renders checklists, links, and standard images', () => {
    const html = renderItineraryMarkdown('- [ ] Sunscreen\n[Open](https://example.com)');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('href="https://example.com"');

    const parsed = parseItinerary('![Roman Odeon](Pasted image 20260819163135.png)', 'trip.md');
    expect(parsed.blocks).toContainEqual({
      type: 'image',
      fileName: 'Pasted image 20260819163135.png',
      alt: 'Roman Odeon',
    });
  });

  it('keeps inlined images from a self-contained html itinerary', () => {
    const parsed = parseItinerary(
      `<!DOCTYPE html>
<html>
<head>
  <title>Kos Road Trip Itinerary</title>
  <meta name="created" content="2026-08-19">
  <meta name="tags" content="holidays,travel">
</head>
<body>
  <p>Base Camp</p>
  <div data-itinerary-map="Roman Odeon of Kos"></div>
  <img alt="Roman Odeon" src="data:image/png;base64,abc">
</body>
</html>`,
      'Kos Road Trip Itinerary.html',
    );

    expect(parsed.title).toBe('Kos Road Trip Itinerary');
    expect(parsed.stops.map((stop) => stop.name)).toEqual(['Roman Odeon of Kos']);
    expect(parsed.blocks).toContainEqual({ type: 'map', name: 'Roman Odeon of Kos', query: 'Roman Odeon of Kos' });
    expect(parsed.blocks).toContainEqual({
      type: 'image',
      alt: 'Roman Odeon',
      src: 'data:image/png;base64,abc',
    });
  });

  it('builds a Google Maps embed url for a stop', () => {
    expect(googleMapsEmbedSrc('Roman Odeon of Kos')).toBe(
      'https://maps.google.com/maps?q=Roman%20Odeon%20of%20Kos&output=embed&z=14',
    );
  });

  it('treats html documents and OTHER assets as itineraries', () => {
    expect(isItineraryAsset({ originalFileName: 'Kos Road Trip Itinerary.html' })).toBe(true);
    expect(isItineraryAsset({ type: 'OTHER' })).toBe(true);
    expect(isItineraryAsset({ originalFileName: 'photo.jpg', type: 'IMAGE' })).toBe(false);
  });
});
