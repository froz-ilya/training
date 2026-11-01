<script lang="ts">
  import { backupFilename } from '../lib/backupReminder';
  import { installedBackup, shareOrDownload } from '../lib/db/backup';
  import { t } from '../lib/i18n.svelte';

  /**
   * Shown instead of the app when its data can't be opened: it's newer than this code, or, with
   * `onskip`, storage stopped an upgrade (see src/lib/db/safety.ts). The data stays untouched here.
   */
  let { onreload, onskip }: { onreload: () => void | Promise<void>; onskip?: () => void } = $props();

  let busy = $state(false);
  let status = $state('');

  async function saveBackup() {
    busy = true;
    status = '';
    try {
      const result = await shareOrDownload(await installedBackup(), backupFilename());
      if (result !== 'cancelled') status = t('settings.backup.saved');
    } catch (e) {
      status = t('settings.backup.failed', { error: (e as Error).message });
    } finally {
      busy = false;
    }
  }
</script>

<div class="page center stack">
  {#if onskip}
    <h1>{t('settings.storage.title')}</h1>
    <p class="muted">{t('settings.storage.body')}</p>
    <button class="btn btn-primary btn-block" onclick={onreload}>{t('settings.storage.retry')}</button>
    <button class="btn btn-block" disabled={busy} onclick={saveBackup}>{t('settings.storage.backup')}</button>
    {#if status}<p class="small" role="status">{status}</p>{/if}
    <button class="btn btn-ghost btn-block" onclick={onskip}>{t('settings.storage.skip')}</button>
    <p class="muted small">{t('settings.storage.hint')}</p>
  {:else}
    <h1>{t('shell.update.title')}</h1>
    <p class="muted">{t('shell.update.body')}</p>
    <button class="btn btn-primary btn-block" onclick={onreload}>{t('shell.update.reload')}</button>
  {/if}
</div>
