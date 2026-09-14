import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import countriesJson from '$lib/assets/geo/countries.json';
import ukNationsJson from '$lib/assets/geo/uk-nations.json';
import usStatesJson from '$lib/assets/geo/us-states.json';

export type RegionKind = 'country' | 'uk-nation' | 'us-state';

export type RegionProperties = {
  id: string;
  name: string;
  kind: RegionKind;
};

export type RegionFeature = Feature<Polygon | MultiPolygon, RegionProperties>;

type MarkerLike = {
  id: string;
  lon: number;
  lat: number;
  country?: string | null;
  state?: string | null;
};

export type VisitedRegions = {
  visitedIds: Set<string>;
  assetsByRegion: Map<string, string[]>;
  visitedFeatures: RegionFeature[];
};

const asCollection = (data: unknown) => data as FeatureCollection<Polygon | MultiPolygon, RegionProperties>;

export const ukNationFeatures = asCollection(ukNationsJson).features as RegionFeature[];
export const usStateFeatures = asCollection(usStatesJson).features as RegionFeature[];
export const countryFeatures = asCollection(countriesJson).features as RegionFeature[];
export const allRegionFeatures: RegionFeature[] = [...ukNationFeatures, ...usStateFeatures, ...countryFeatures];

export const regionById = new Map(allRegionFeatures.map((feature) => [feature.properties.id, feature]));

const foldName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

const indexByName = (features: RegionFeature[]) => {
  const index = new Map<string, RegionFeature>();
  for (const feature of features) {
    index.set(foldName(feature.properties.name), feature);
    index.set(foldName(feature.properties.id), feature);
  }
  return index;
};

const countryByName = indexByName(countryFeatures);
const usStateByName = indexByName(usStateFeatures);
const ukNationByName = indexByName(ukNationFeatures);

const COUNTRY_ALIASES: Record<string, string> = {
  'cape verde': 'cabo verde',
  'czech republic': 'czechia',
  'east timor': 'timor-leste',
  swaziland: 'eswatini',
  turkey: 'turkiye',
};

for (const [alias, canonical] of Object.entries(COUNTRY_ALIASES)) {
  const feature = countryByName.get(canonical);
  if (feature) {
    countryByName.set(alias, feature);
  }
}

const US_COUNTRY_NAMES = new Set(['united states', 'united states of america', 'usa', 'us']);
const UK_COUNTRY_NAMES = new Set(['united kingdom', 'great britain', 'uk', 'gb']);

const pointInRing = (lon: number, lat: number, ring: Position[]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLon, currentLat] = ring[index];
    const [previousLon, previousLat] = ring[previous];
    const intersects =
      currentLat > lat !== previousLat > lat &&
      lon < ((previousLon - currentLon) * (lat - currentLat)) / (previousLat - currentLat || Number.EPSILON) + currentLon;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
};

const pointInPolygonCoordinates = (lon: number, lat: number, coordinates: Position[][]): boolean => {
  if (!pointInRing(lon, lat, coordinates[0])) {
    return false;
  }
  for (const hole of coordinates.slice(1)) {
    if (pointInRing(lon, lat, hole)) {
      return false;
    }
  }
  return true;
};

export const geometryContainsPoint = (geometry: Geometry, lon: number, lat: number): boolean => {
  if (geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(lon, lat, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInPolygonCoordinates(lon, lat, polygon));
  }
  return false;
};

export const regionForPoint = (lon: number, lat: number): RegionFeature | undefined => {
  for (const feature of ukNationFeatures) {
    if (geometryContainsPoint(feature.geometry, lon, lat)) {
      return feature;
    }
  }
  for (const feature of usStateFeatures) {
    if (geometryContainsPoint(feature.geometry, lon, lat)) {
      return feature;
    }
  }
  for (const feature of countryFeatures) {
    if (geometryContainsPoint(feature.geometry, lon, lat)) {
      return feature;
    }
  }
};

export const regionFromGeocode = (marker: MarkerLike): RegionFeature | undefined => {
  const country = marker.country ? foldName(marker.country) : '';
  const state = marker.state ? foldName(marker.state) : '';

  if (country && US_COUNTRY_NAMES.has(country) && state) {
    const usState = usStateByName.get(state);
    if (usState) {
      return usState;
    }
  }

  if (country && UK_COUNTRY_NAMES.has(country) && state) {
    const ukNation = ukNationByName.get(state);
    if (ukNation) {
      return ukNation;
    }
  }

  if (country) {
    return countryByName.get(country);
  }
};

export const regionForMarker = (marker: MarkerLike): RegionFeature | undefined =>
  regionForPoint(marker.lon, marker.lat) ?? regionFromGeocode(marker);

export const visitedFromMarkers = (markers: MarkerLike[]): VisitedRegions => {
  const visitedIds = new Set<string>();
  const assetsByRegion = new Map<string, string[]>();
  const visitedFeatureIds: string[] = [];

  for (const marker of markers) {
    const region = regionForMarker(marker);
    if (!region) {
      continue;
    }
    const { id } = region.properties;
    if (!visitedIds.has(id)) {
      visitedIds.add(id);
      visitedFeatureIds.push(id);
    }
    const assets = assetsByRegion.get(id);
    if (assets) {
      assets.push(marker.id);
    } else {
      assetsByRegion.set(id, [marker.id]);
    }
  }

  return {
    visitedIds,
    assetsByRegion,
    visitedFeatures: visitedFeatureIds.map((id) => regionById.get(id)!),
  };
};

export const regionsWithVisitedFlag = (
  visitedIds: Set<string>,
): FeatureCollection<Polygon | MultiPolygon, RegionProperties & { visited: boolean }> => ({
  type: 'FeatureCollection',
  features: allRegionFeatures.map((feature) => ({
    ...feature,
    id: feature.properties.id,
    properties: {
      ...feature.properties,
      visited: visitedIds.has(feature.properties.id),
    },
  })),
});

export type RegionBBox = { west: number; south: number; east: number; north: number };

const extendBoxWithCoordinates = (box: RegionBBox, coordinates: unknown) => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return;
  }
  if (typeof coordinates[0] === 'number') {
    const lon = coordinates[0] as number;
    const lat = coordinates[1] as number;
    box.west = Math.min(box.west, lon);
    box.east = Math.max(box.east, lon);
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
    return;
  }
  for (const child of coordinates) {
    extendBoxWithCoordinates(box, child);
  }
};

export const bboxFromFeatures = (features: RegionFeature[]): RegionBBox | undefined => {
  if (features.length === 0) {
    return undefined;
  }
  const box: RegionBBox = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (const feature of features) {
    if (feature.geometry.type === 'GeometryCollection') {
      continue;
    }
    extendBoxWithCoordinates(box, feature.geometry.coordinates);
  }
  if (!Number.isFinite(box.west)) {
    return undefined;
  }
  return box;
};
