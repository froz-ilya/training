<script lang="ts">
  import StatusChip from '../coach/StatusChip.svelte';
  import type { ExerciseView } from '../../lib/coach/data';
  import { topSet } from '../../lib/coach/strength';
  import { fmtSet } from '../../lib/coach/text';
  import { nameOf } from '../../lib/exercises.svelte';

  /** Exercises with their latest set and status; a row opens the exercise. */
  let { items }: { items: ExerciseView[] } = $props();

  function latestSet(view: ExerciseView): string {
    const top = topSet(view.sessions[view.sessions.length - 1]);
    return top ? fmtSet(top, view.exercise.load) : '';
  }
</script>

<div class="list">
  {#each items as view (view.exercise.id)}
    <a class="list-item" href="#/exercise/{view.exercise.id}">
      <span class="body">
        <span class="title">{nameOf(view.exercise)}</span>
        <span class="sub">{latestSet(view)}</span>
      </span>
      <StatusChip state={view.status.state} asking={view.status.maybeMachineChange} />
    </a>
  {/each}
</div>

<style>
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
