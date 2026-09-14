import { regionForMarker, regionForPoint, visitedFromMarkers } from '$lib/utils/visited-regions';

describe('regionForPoint', () => {
  it('assigns London to England', () => {
    expect(regionForPoint(-0.1278, 51.5074)?.properties.id).toBe('GB-ENG');
  });

  it('assigns Cardiff to Wales', () => {
    expect(regionForPoint(-3.1791, 51.4816)?.properties.id).toBe('GB-WLS');
  });

  it('assigns Edinburgh to Scotland', () => {
    expect(regionForPoint(-3.1883, 55.9533)?.properties.id).toBe('GB-SCT');
  });

  it('assigns Belfast to Northern Ireland instead of Ireland', () => {
    expect(regionForPoint(-5.9301, 54.5973)?.properties.id).toBe('GB-NIR');
  });

  it('assigns Manhattan to New York', () => {
    expect(regionForPoint(-74.006, 40.7128)?.properties.id).toBe('US-NY');
  });

  it('assigns Washington DC to US-DC', () => {
    expect(regionForPoint(-77.0369, 38.9072)?.properties.id).toBe('US-DC');
  });

  it('assigns Paris to France', () => {
    expect(regionForPoint(2.3522, 48.8566)?.properties.id).toBe('FR');
  });

  it('assigns Kos to Greece', () => {
    expect(regionForPoint(27.2877, 36.8933)?.properties.id).toBe('GR');
  });

  it('does not assign a Puerto Morelos beach pin from geometry alone', () => {
    expect(regionForPoint(-86.865037, 20.877968)).toBeUndefined();
  });

  it('does not assign a point in the Atlantic', () => {
    expect(regionForPoint(-30, 40)).toBeUndefined();
  });
});

describe('visitedFromMarkers', () => {
  it('paints a region gold from one pin and ignores sea photos', () => {
    const visited = visitedFromMarkers([
      { id: 'paris', lon: 2.3522, lat: 48.8566 },
      { id: 'sea', lon: -30, lat: 40 },
      { id: 'paris-2', lon: 2.35, lat: 48.85 },
    ]);

    expect([...visited.visitedIds]).toEqual(['FR']);
    expect(visited.assetsByRegion.get('FR')).toEqual(['paris', 'paris-2']);
    expect(visited.visitedFeatures).toHaveLength(1);
  });

  it('scratches Mexico from a coastal pin using Immich geocode', () => {
    const visited = visitedFromMarkers([
      {
        id: 'puerto-morelos',
        lon: -86.865037,
        lat: 20.877968,
        country: 'Mexico',
        state: 'Quintana Roo',
      },
    ]);

    expect([...visited.visitedIds]).toEqual(['MX']);
  });
});

describe('regionForMarker', () => {
  it('maps Cape Verde geocode onto Cabo Verde', () => {
    expect(
      regionForMarker({
        id: 'sal',
        lon: 0,
        lat: 0,
        country: 'Cape Verde',
        state: 'Sal',
      })?.properties.id,
    ).toBe('CV');
  });

  it('maps United States geocode onto a US state', () => {
    expect(
      regionForMarker({
        id: 'miami',
        lon: 0,
        lat: 0,
        country: 'United States of America',
        state: 'Florida',
      })?.properties.id,
    ).toBe('US-FL');
  });

  it('maps United Kingdom geocode onto a nation', () => {
    expect(
      regionForMarker({
        id: 'cardiff',
        lon: 0,
        lat: 0,
        country: 'United Kingdom',
        state: 'Wales',
      })?.properties.id,
    ).toBe('GB-WLS');
  });
});
