<script lang="ts">
  import { photoUrl, type ExercisePhoto } from '../../lib/catalog/photos';
  import { t, tParts } from '../../lib/i18n.svelte';

  let { photo, name }: { photo: ExercisePhoto; name: string } = $props();
</script>

<figure class="photo">
  <img src={photoUrl(photo)} alt={t('exercise.photo.alt', { name })} width={photo.width} height={photo.height} />
  <figcaption class="muted">
    {#each tParts('exercise.photo.credit') as part, i (i)}
      {#if part.slot === 'author'}
        <a href={photo.source} target="_blank" rel="noopener noreferrer">{photo.author}</a>
      {:else if part.slot === 'license'}
        {#if photo.licenseUrl}
          <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a>
        {:else}
          {photo.license}
        {/if}
      {:else}
        {part.text}
      {/if}
    {/each}
  </figcaption>
</figure>

<style>
  .photo {
    margin: 0 0 16px;
  }
  img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 340px;
    object-fit: contain;
    background: var(--surface-2);
    border-radius: var(--radius);
  }
  figcaption {
    margin-top: 6px;
    padding: 0 4px;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  a {
    color: inherit;
    text-decoration: underline;
  }
</style>
