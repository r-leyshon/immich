<script lang="ts" module>
  import mapboxRtlUrl from '@mapbox/mapbox-gl-rtl-text?url';
  import { addProtocol, setRTLTextPlugin, setWorkerUrl } from 'maplibre-gl';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';

  let protocol = new Protocol();
  setWorkerUrl(workerUrl);
  void addProtocol('pmtiles', protocol.tile);
  void setRTLTextPlugin(mapboxRtlUrl, true);
</script>

<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import MapSettingsModal from '$lib/modals/MapSettingsModal.svelte';
  import { mapSettings } from '$lib/stores/preferences.store';
  import { websocketEvents } from '$lib/stores/websocket';
  import { getAssetMediaUrl, handlePromiseError } from '$lib/utils';
  import { isItineraryAsset } from '$lib/utils/itinerary-markdown';
  import { bboxFromFeatures, regionById, visitedFromMarkers } from '$lib/utils/visited-regions';
  import { getMapMarkers, type MapMarkerResponseDto } from '@immich/sdk';
  import { Alert, Container, Icon, modalManager, Text, Theme, themeManager } from '@immich/ui';
  import { mdiCog, mdiFileDocumentOutline, mdiImageMultiple, mdiMap, mdiMapMarker, mdiMapMarkerOff } from '@mdi/js';
  import type { Feature, GeoJsonProperties, Geometry, Point } from 'geojson';
  import { isEqual, omit } from 'lodash-es';
  import { DateTime, Duration } from 'luxon';
  import {
    GlobeControl,
    LngLat,
    LngLatBounds,
    Marker,
    type GeoJSONSource,
    type LngLatLike,
    type Map,
    type MapMouseEvent,
  } from 'maplibre-gl';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';
  import {
    AttributionControl,
    Control,
    ControlButton,
    ControlGroup,
    FillLayer,
    GeoJSON,
    GeolocateControl,
    LineLayer,
    MapLibre,
    MarkerLayer,
    NavigationControl,
    Popup,
    ScaleControl,
  } from 'svelte-maplibre';
  import type { SelectionBBox } from './types';

  interface Props {
    mapMarkers?: MapMarkerResponseDto[];
    showSettings?: boolean;
    zoom?: number | undefined;
    center?: LngLatLike | undefined;
    hash?: boolean;
    simplified?: boolean;
    clickable?: boolean;
    useLocationPin?: boolean;
    onOpenInMapView?: (() => Promise<void> | void) | undefined;
    onSelect?: (assetIds: string[]) => void;
    onClusterSelect?: (assetIds: string[], bbox: SelectionBBox) => void;
    onViewportClose?: () => void;
    viewportGridActive?: boolean;
    autoOpenPanel?: boolean;
    onClickPoint?: ({ lat, lng }: { lat: number; lng: number }) => void;
    popup?: import('svelte').Snippet<[{ marker: MapMarkerResponseDto }]>;
    rounded?: boolean;
    showSimpleControls?: boolean;
    autoFitBounds?: boolean;
  }

  let {
    mapMarkers = $bindable(),
    showSettings = true,
    zoom = undefined,
    center = $bindable(undefined),
    hash = false,
    simplified = false,
    clickable = false,
    useLocationPin = false,
    onOpenInMapView = undefined,
    onSelect = () => {},
    onClusterSelect,
    onViewportClose,
    viewportGridActive = false,
    autoOpenPanel = false,
    onClickPoint = () => {},
    popup,
    rounded = false,
    showSimpleControls = true,
    autoFitBounds = true,
  }: Props = $props();

  const boundsFromMarkers = (markers: MapMarkerResponseDto[]) => {
    const bounds = new LngLatBounds();
    for (const marker of markers) {
      bounds.extend([marker.lon, marker.lat]);
    }
    return bounds;
  };

  // Preloaded markers (album modal) can fit on first paint. The main /map page
  // loads markers asynchronously, so it also fits in the $effect below.
  const initialBounds = (() => {
    if (!autoFitBounds || center || zoom !== undefined || !mapMarkers || mapMarkers.length === 0) {
      return undefined;
    }

    return boundsFromMarkers(mapMarkers);
  })();

  // Capture before MapLibre writes its own hash from the default camera.
  const hasUrlCamera =
    hash && typeof location !== 'undefined' && /#([\d.eE+-]+)\/(-?[\d.eE+-]+)\/(-?[\d.eE+-]+)/.test(location.hash);

  let map: Map | undefined = $state();
  let fittedForMarkers: MapMarkerResponseDto[] | undefined;
  let marker: Marker | null = null;
  const failedMapPreviews = new SvelteSet<string>();
  let abortController: AbortController;
  let unsubscribeUpload: (() => void) | undefined;

  const displayPhotoMarkers = $derived(
    simplified || clickable || useLocationPin || !showSettings || $mapSettings.showPhotoMarkers,
  );
  const showVisitedRegions = $derived(!clickable);

  const visitedRegions = $derived(visitedFromMarkers(mapMarkers ?? []));
  const visitedRegionData = $derived({
    type: 'FeatureCollection' as const,
    features: visitedRegions.visitedFeatures,
  });
  const mapTheme = $derived($mapSettings.allowDarkMode ? themeManager.value : Theme.Light);
  const styleUrl = $derived(
    mapTheme === Theme.Dark ? serverConfigManager.value.mapDarkStyleUrl : serverConfigManager.value.mapLightStyleUrl,
  );

  export function addClipMapMarker(lng: number, lat: number) {
    if (!map) {
      return;
    }

    if (marker) {
      marker.remove();
    }

    center = { lng, lat };
    marker = new Marker().setLngLat([lng, lat]).addTo(map);
  }

  function handleAssetClick(assetId: string, map: Map | null) {
    if (!map) {
      return;
    }
    onSelect([assetId]);
  }

  async function handleClusterClick(clusterId: number, map: Map | null) {
    if (!map) {
      return;
    }

    const mapSource = map.getSource('geojson') as GeoJSONSource;
    const leaves = await mapSource.getClusterLeaves(clusterId, 10_000, 0);
    const ids = leaves.map((leaf) => leaf.properties?.id as string);

    if (onClusterSelect && ids.length > 1) {
      const [firstLongitude, firstLatitude] = (leaves[0].geometry as Point).coordinates;
      let west = firstLongitude;
      let south = firstLatitude;
      let east = firstLongitude;
      let north = firstLatitude;

      for (const leaf of leaves.slice(1)) {
        const [longitude, latitude] = (leaf.geometry as Point).coordinates;
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }

      const bbox = { west, south, east, north };
      onClusterSelect(ids, bbox);
      return;
    }

    onSelect(ids);
  }

  function handleMapClick(event: MapMouseEvent) {
    if (!clickable) {
      return;
    }

    const { lng, lat } = event.lngLat;
    onClickPoint({ lng, lat });

    if (marker) {
      marker.remove();
    }

    if (map) {
      marker = new Marker().setLngLat([lng, lat]).addTo(map);
    }
  }

  type FeaturePoint = Feature<
    Point,
    {
      id: string;
      city: string | null;
      state: string | null;
      country: string | null;
      originalFileName: string | null;
      type: string | null;
    }
  >;

  const asFeature = (marker: MapMarkerResponseDto): FeaturePoint => {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [marker.lon, marker.lat] },
      properties: {
        id: marker.id,
        city: marker.city,
        state: marker.state,
        country: marker.country,
        originalFileName: marker.originalFileName ?? null,
        type: marker.type ?? null,
      },
    };
  };

  const asMarker = (feature: Feature<Geometry, GeoJsonProperties>): MapMarkerResponseDto => {
    const featurePoint = feature as FeaturePoint;
    const coords = LngLat.convert(featurePoint.geometry.coordinates as [number, number]);
    return {
      lat: coords.lat,
      lon: coords.lng,
      id: featurePoint.properties.id,
      city: featurePoint.properties.city,
      state: featurePoint.properties.state,
      country: featurePoint.properties.country,
      originalFileName: featurePoint.properties.originalFileName ?? undefined,
      type: featurePoint.properties.type ?? undefined,
    };
  };

  function getFileCreatedDates() {
    const { relativeDate, dateAfter, dateBefore } = $mapSettings;

    if (relativeDate) {
      const duration = Duration.fromISO(relativeDate);
      return {
        fileCreatedAfter: duration.isValid ? DateTime.now().minus(duration).toUTC().toISO() : undefined,
      };
    }

    return {
      // $mapSettings stores no value as an empty string
      fileCreatedAfter: dateAfter || undefined,
      fileCreatedBefore: dateBefore || undefined,
    };
  }

  async function loadMapMarkers() {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    const { includeArchived, onlyFavorites, withPartners, withSharedAlbums } = $mapSettings;
    const { fileCreatedAfter, fileCreatedBefore } = getFileCreatedDates();

    return await getMapMarkers(
      {
        isArchived: includeArchived || undefined,
        isFavorite: onlyFavorites || undefined,
        fileCreatedAfter,
        fileCreatedBefore,
        withPartners: withPartners || undefined,
        withSharedAlbums: withSharedAlbums || undefined,
      },
      {
        signal: abortController.signal,
      },
    );
  }

  const handleSettingsClick = async () => {
    const settings = await modalManager.show(MapSettingsModal);
    if (settings) {
      const shouldUpdate = !isEqual(
        omit(settings, 'allowDarkMode', 'showPhotoMarkers'),
        omit($mapSettings, 'allowDarkMode', 'showPhotoMarkers'),
      );
      $mapSettings = settings;

      if (shouldUpdate) {
        mapMarkers = await loadMapMarkers();
      }
    }
  };

  afterNavigate(() => {
    if (!map) {
      return;
    }

    map.resize();

    if (location.hash) {
      const hashChangeEvent = new HashChangeEvent('hashchange');
      // eslint-disable-next-line unicorn/no-unnecessary-global-this
      globalThis.dispatchEvent(hashChangeEvent);
    }
  });

  onMount(async () => {
    unsubscribeUpload = websocketEvents.on('on_upload_success', () => {
      handlePromiseError(onAssetsChanged());
    });
    if (!mapMarkers) {
      mapMarkers = await loadMapMarkers();
    }
    if (autoOpenPanel) {
      // Wait for the map to finish rendering before opening the panel
      await tick();
      if (map) {
        map.resize();
        await map.once('idle');
        handleViewportSelect();
      }
    }
  });

  onDestroy(() => {
    unsubscribeUpload?.();
    abortController?.abort();
  });

  $effect(() => {
    map?.setStyle(styleUrl, {
      transformStyle: (previousStyle, nextStyle) => {
        if (previousStyle) {
          // Preserves the custom map markers from the previous style when the theme is switched
          // Required until https://github.com/dimfeld/svelte-maplibre/issues/146 is fixed
          const customLayers = previousStyle.layers.filter((layer) => {
            const source = 'source' in layer ? layer.source : undefined;
            return source === 'geojson' || source === 'visited-regions';
          });
          const layers = nextStyle.layers.concat(customLayers);
          const sources = nextStyle.sources;

          for (const [key, value] of Object.entries(previousStyle.sources || {})) {
            if (key.startsWith('geojson') || key === 'visited-regions') {
              sources[key] = value;
            }
          }

          return {
            ...nextStyle,
            sources,
            layers,
          };
        }
        return nextStyle;
      },
    });
  });

  $effect(() => {
    if (!center || !zoom) {
      return;
    }

    untrack(() => map?.jumpTo({ center, zoom }));
  });

  $effect(() => {
    const ready = map;
    const markers = mapMarkers;
    if (!ready || !autoFitBounds || center || zoom !== undefined || hasUrlCamera) {
      return;
    }
    if (!markers?.length || fittedForMarkers === markers) {
      return;
    }

    untrack(() => {
      // Fit the photo GPS, not country envelopes (Mexico/England/etc. are huge).
      ready.fitBounds(boundsFromMarkers(markers), {
        padding: 56,
        maxZoom: displayPhotoMarkers ? 15 : 10,
        duration: 600,
      });
      fittedForMarkers = markers;
    });
  });

  const handleViewportSelect = () => {
    if (!map || !onClusterSelect || !mapMarkers) {
      return;
    }
    const bounds = map.getBounds();
    const west = bounds.getWest();
    const east = bounds.getEast();

    // When zoomed out enough to see the whole world, show all markers
    const showAll = east - west >= 360;
    const visibleIds = showAll
      ? mapMarkers.map(({ id }) => id)
      : mapMarkers.filter(({ lon, lat }) => bounds.contains([lon, lat])).map(({ id }) => id);

    const bbox: SelectionBBox = {
      west: showAll ? -180 : west,
      south: showAll ? -90 : bounds.getSouth(),
      east: showAll ? 180 : east,
      north: showAll ? 90 : bounds.getNorth(),
    };
    onClusterSelect(visibleIds, bbox);
  };

  const handleMoveEnd = () => {
    if (viewportGridActive && !assetViewerManager.isViewing) {
      handleViewportSelect();
    }
  };

  const fitToRegion = (regionId: string) => {
    const feature = regionById.get(regionId);
    if (!map || !feature) {
      return;
    }
    const box = bboxFromFeatures([feature]);
    if (!box) {
      return;
    }
    map.fitBounds(
      [
        [box.west, box.south],
        [box.east, box.north],
      ],
      { padding: 48, maxZoom: 8, duration: 500 },
    );
  };

  const handleRegionClick = (event: { feature?: Feature; features?: Feature[] }) => {
    if (clickable) {
      return;
    }
    const regionId = (event.feature ?? event.features?.[0])?.properties?.id as string | undefined;
    if (!regionId) {
      return;
    }

    fitToRegion(regionId);

    const assetIds = visitedRegions.assetsByRegion.get(regionId);
    if (!onClusterSelect || !assetIds?.length) {
      return;
    }

    const feature = regionById.get(regionId);
    const box = feature ? bboxFromFeatures([feature]) : undefined;
    onClusterSelect(assetIds, {
      west: box?.west ?? -180,
      south: box?.south ?? -90,
      east: box?.east ?? 180,
      north: box?.north ?? 90,
    });
  };

  const togglePhotoMarkers = () => {
    $mapSettings = { ...$mapSettings, showPhotoMarkers: !$mapSettings.showPhotoMarkers };
  };

  const onAssetsChanged = async () => {
    mapMarkers = await loadMapMarkers();
  };
</script>

<OnEvents onAssetsDelete={onAssetsChanged} onAssetsArchive={onAssetsChanged} onAssetsUnarchive={onAssetsChanged} />
<svelte:boundary>
  <!--  We handle style loading ourselves so we set style blank here -->
  <MapLibre
    {hash}
    style=""
    class="h-full {rounded ? 'rounded-2xl' : 'rounded-none'}"
    {zoom}
    {center}
    bounds={initialBounds}
    fitBoundsOptions={{ padding: 50, maxZoom: 15 }}
    attributionControl={false}
    diffStyleUpdates={true}
    onload={(event: Map) => {
      event.setMaxZoom(18);
      event.on('click', handleMapClick);
      event.on('moveend', handleMoveEnd);
      if (!simplified) {
        event.addControl(new GlobeControl(), 'top-left');
      }
    }}
    bind:map
  >
    {#snippet children({ map }: { map: Map })}
      {#if showSimpleControls}
        <NavigationControl position="top-left" showCompass={!simplified} />

        {#if !simplified}
          <GeolocateControl position="top-left" />
          {#if onClusterSelect}
            <Control position="top-left">
              <ControlGroup>
                <ControlButton onclick={() => (viewportGridActive ? onViewportClose?.() : handleViewportSelect())}>
                  <Icon title={$t('show_photos_in_area')} icon={mdiImageMultiple} size="70%" class="text-black/80" />
                </ControlButton>
              </ControlGroup>
            </Control>
          {/if}
          <ScaleControl />
          <AttributionControl compact={false} />
        {/if}
      {/if}

      {#if showSettings}
        <Control>
          <ControlGroup>
            <ControlButton onclick={togglePhotoMarkers}>
              <Icon
                title={$mapSettings.showPhotoMarkers ? $t('hide_photo_markers') : $t('show_photo_markers')}
                icon={$mapSettings.showPhotoMarkers ? mdiMapMarker : mdiMapMarkerOff}
                size="70%"
                class="text-black/80"
              />
            </ControlButton>
          </ControlGroup>
        </Control>
        <Control>
          <ControlGroup>
            <ControlButton onclick={handleSettingsClick}>
              <Icon icon={mdiCog} size="70%" class="text-black/80" />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      {#if onOpenInMapView && showSimpleControls}
        <Control position="top-right">
          <ControlGroup>
            <ControlButton onclick={() => onOpenInMapView()}>
              <Icon title={$t('open_in_map_view')} icon={mdiMap} size="100%" class="text-black/80" />
            </ControlButton>
          </ControlGroup>
        </Control>
      {/if}

      {#if showVisitedRegions}
        <GeoJSON id="visited-regions" data={visitedRegionData} generateId>
          <FillLayer
            hoverCursor="pointer"
            paint={{
              'fill-color': '#c9a227',
              'fill-opacity': 0.72,
            }}
            onclick={handleRegionClick}
          />
          <LineLayer
            interactive={false}
            paint={{
              'line-color': '#8a6d1f',
              'line-width': 1.2,
              'line-opacity': 0.9,
            }}
          />
        </GeoJSON>
      {/if}

      <GeoJSON
        data={{
          type: 'FeatureCollection',
          features: displayPhotoMarkers ? (mapMarkers?.map((marker) => asFeature(marker)) ?? []) : [],
        }}
        id="geojson"
        cluster={{ radius: 35, maxZoom: 18 }}
      >
        <MarkerLayer
          applyToClusters
          asButton
          onclick={(event) => handlePromiseError(handleClusterClick(event.feature.properties?.cluster_id, map))}
        >
          {#snippet children({ feature })}
            <div
              class="flex size-10 items-center justify-center rounded-full bg-immich-primary font-mono font-bold text-white opacity-90 shadow-lg transition-all duration-200 hover:bg-immich-dark-primary hover:text-immich-dark-bg"
            >
              {feature.properties?.point_count?.toLocaleString()}
            </div>
          {/snippet}
        </MarkerLayer>
        <MarkerLayer
          applyToClusters={false}
          asButton
          onclick={(event) => {
            if (!popup) {
              handleAssetClick(event.feature.properties?.id, map);
            }
          }}
        >
          {#snippet children({ feature }: { feature: Feature })}
            {#if useLocationPin}
              <Icon icon={mdiMapMarker} size="50px" class="translate-y-[calc(5px-50%)] text-primary" />
            {:else if isItineraryAsset({
              originalFileName: feature.properties?.originalFileName,
              type: feature.properties?.type,
            })}
              {@const markerId = String(feature.properties?.id ?? '')}
              {@const itineraryAlt =
                feature.properties?.city && feature.properties.country
                  ? $t('map_marker_for_itinerary', {
                      values: { city: feature.properties.city, country: feature.properties.country },
                    })
                  : $t('itinerary')}
              <div
                class="relative flex size-15 items-center justify-center overflow-hidden rounded-full border-2 border-immich-primary bg-[#e8eef7] shadow-lg transition-all duration-200 hover:scale-150 hover:border-immich-dark-primary"
                title={itineraryAlt}
              >
                {#if markerId && !failedMapPreviews.has(markerId)}
                  <img
                    src={getAssetMediaUrl({ id: markerId })}
                    class="size-full object-cover"
                    alt={itineraryAlt}
                    onerror={() => failedMapPreviews.add(markerId)}
                  />
                {:else}
                  <Icon icon={mdiFileDocumentOutline} size="28" class="text-immich-primary" />
                {/if}
              </div>
            {:else}
              <img
                src={getAssetMediaUrl({ id: feature.properties?.id })}
                class="size-15 rounded-full border-2 border-immich-primary bg-immich-primary object-cover shadow-lg transition-all duration-200 hover:scale-150 hover:border-immich-dark-primary"
                alt={feature.properties?.city && feature.properties.country
                  ? $t('map_marker_for_image', {
                      values: { city: feature.properties.city, country: feature.properties.country },
                    })
                  : $t('map_marker_with_image')}
              />
            {/if}
            {#if popup}
              <Popup offset={[0, -30]} openOn="click" closeOnClickOutside>
                {@render popup({ marker: asMarker(feature) })}
              </Popup>
            {/if}
          {/snippet}
        </MarkerLayer>
      </GeoJSON>
    {/snippet}
  </MapLibre>

  {#snippet failed()}
    <Container size="small" class="p-2">
      <Alert color="warning" title={$t('errors.unable_to_load_map')} size={simplified ? 'medium' : 'large'}>
        <Text size={simplified ? 'small' : 'medium'}>{$t('errors.unable_to_load_map_description')}</Text>
      </Alert>
    </Container>
  {/snippet}
</svelte:boundary>
