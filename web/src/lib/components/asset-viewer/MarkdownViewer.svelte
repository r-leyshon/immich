<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { googleMapsEmbedSrc, parseItinerary, type ItineraryBlock } from '$lib/utils/itinerary-markdown';
  import { AssetMediaSize, downloadAsset, searchAssets, type AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    asset: AssetResponseDto;
  }

  let { asset }: Props = $props();

  let markdown = $state('');
  let imageUrls = $state<Record<string, string>>({});
  let loading = $state(true);

  const parsed = $derived(parseItinerary(markdown, asset.originalFileName));

  const imageSrc = (block: Extract<ItineraryBlock, { type: 'image' }>) => {
    if (block.src) {
      return block.src;
    }
    if (block.fileName) {
      return imageUrls[block.fileName.toLowerCase()];
    }
    return undefined;
  };

  const resolveImages = async (fileNames: string[]) => {
    const urls: Record<string, string> = {};
    await Promise.all(
      fileNames.map(async (fileName) => {
        try {
          const result = await searchAssets({
            metadataSearchDto: { originalFileName: fileName, size: 20, withExif: false },
          });
          const match = result.assets.items.find(
            (item) => item.originalFileName.localeCompare(fileName, undefined, { sensitivity: 'accent' }) === 0,
          );
          if (match) {
            urls[fileName.toLowerCase()] = getAssetMediaUrl({
              id: match.id,
              cacheKey: match.thumbhash,
              size: AssetMediaSize.Preview,
            });
          }
        } catch {
          // Leave the embed as a caption if the photo is not in Immich yet.
        }
      }),
    );
    imageUrls = urls;
  };

  const load = async () => {
    loading = true;
    imageUrls = {};
    try {
      const file = await downloadAsset({ id: asset.id });
      markdown = await file.text();
      const fileNames = [
        ...new Set(
          parseItinerary(markdown, asset.originalFileName)
            .blocks.filter(
              (block): block is Extract<ItineraryBlock, { type: 'image' }> =>
                block.type === 'image' && Boolean(block.fileName) && !block.src,
            )
            .map((block) => block.fileName as string),
        ),
      ];
      if (fileNames.length > 0) {
        await resolveImages(fileNames);
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_itinerary'));
    } finally {
      loading = false;
    }
  };

  $effect(() => {
    asset.id;
    void load();
  });
</script>

<div class="size-full overflow-y-auto bg-light text-dark">
  {#if loading}
    <div class="flex size-full items-center justify-center">
      <LoadingSpinner />
    </div>
  {:else}
    <article class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <header class="flex flex-col gap-1">
        <Text size="small" class="uppercase tracking-wide text-gray-500">{$t('itinerary')}</Text>
        <h1 class="text-2xl font-semibold">{parsed.title}</h1>
      </header>

      {#each parsed.blocks as block, index (index)}
        {#if block.type === 'html'}
          <div class="itinerary-prose">
            {@html block.html}
          </div>
        {:else if block.type === 'image'}
          {@const src = imageSrc(block)}
          {#if src}
            <img class="itinerary-photo" src={src} alt={block.alt} />
          {:else}
            <em class="itinerary-embed">{block.alt || block.fileName}</em>
          {/if}
        {:else}
          <figure class="flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            <iframe
              class="h-72 w-full border-0"
              src={googleMapsEmbedSrc(block.query)}
              title={block.name}
              loading="lazy"
              referrerpolicy="no-referrer-when-downgrade"
              allowfullscreen
            ></iframe>
            <figcaption class="bg-white px-3 py-2 text-sm font-medium dark:bg-immich-dark-gray">{block.name}</figcaption>
          </figure>
        {/if}
      {/each}
    </article>
  {/if}
</div>

<style>
  :global(.itinerary-prose h2) {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0.5rem 0;
  }

  :global(.itinerary-prose h3) {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0.75rem 0 0.35rem;
  }

  :global(.itinerary-prose h4) {
    font-size: 1rem;
    font-weight: 600;
    margin: 0.75rem 0 0.25rem;
  }

  :global(.itinerary-prose p),
  :global(.itinerary-prose li),
  :global(.itinerary-prose blockquote) {
    line-height: 1.55;
  }

  :global(.itinerary-prose ul) {
    list-style: disc;
    padding-inline-start: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  :global(.itinerary-prose hr) {
    border-color: rgb(229 231 235);
    margin: 1rem 0;
  }

  :global(.itinerary-prose a) {
    color: var(--immich-primary);
    text-decoration: underline;
  }

  :global(.itinerary-prose blockquote) {
    border-inline-start: 3px solid var(--immich-primary);
    padding-inline-start: 0.75rem;
  }

  :global(.itinerary-prose .itinerary-checklist),
  :global(.itinerary-prose .checklist) {
    list-style: none;
    padding: 0;
  }

  :global(.itinerary-embed) {
    display: block;
    margin: 0.75rem 0;
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: rgb(243 244 246);
    font-style: italic;
  }

  :global(.itinerary-photo) {
    display: block;
    width: 100%;
    border-radius: 0.75rem;
    object-fit: cover;
    max-height: 28rem;
  }
</style>
