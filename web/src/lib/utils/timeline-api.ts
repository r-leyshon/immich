import { defaults, getTimeBucket as sdkGetTimeBucket, getTimeBuckets as sdkGetTimeBuckets } from '@immich/sdk';
import type { TimelineManagerOptions } from '$lib/managers/timeline-manager/types';

type TimelineQuery = TimelineManagerOptions & { timeBucket?: string };

const QUERY_KEYS = [
  'albumId',
  'assetType',
  'bbox',
  'isFavorite',
  'isTrashed',
  'key',
  'order',
  'orderBy',
  'personId',
  'slug',
  'tagId',
  'timeBucket',
  'userId',
  'visibility',
  'withCoordinates',
  'withPartners',
  'withStacked',
] as const;

const toSearchParams = (params: TimelineQuery) => {
  const search = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const value = params[key as keyof TimelineQuery];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  return search;
};

const timelineFetch = async <T>(path: string, params: TimelineQuery, opts?: { signal?: AbortSignal }): Promise<T> => {
  const url = `${defaults.baseUrl}${path}?${toSearchParams(params)}`;
  const fetchImpl = defaults.fetch ?? globalThis.fetch;
  const response = await fetchImpl(url, { signal: opts?.signal, credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Timeline request failed (${response.status})`);
  }
  return (await response.json()) as T;
};

export const getTimeBuckets = (params: TimelineQuery, opts?: { signal?: AbortSignal }) => {
  if (params.assetType && !import.meta.env.VITEST) {
    return timelineFetch<Awaited<ReturnType<typeof sdkGetTimeBuckets>>>('/timeline/buckets', params, opts);
  }
  return sdkGetTimeBuckets(params, opts);
};

export const getTimeBucket = (params: TimelineQuery & { timeBucket: string }, opts?: { signal?: AbortSignal }) => {
  if (params.assetType && !import.meta.env.VITEST) {
    return timelineFetch<Awaited<ReturnType<typeof sdkGetTimeBucket>>>('/timeline/bucket', params, opts);
  }
  return sdkGetTimeBucket(params, opts);
};
