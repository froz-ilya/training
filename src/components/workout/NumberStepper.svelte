<script lang="ts">
  import Icon from '../Icon.svelte';
  import { locale, t } from '../../lib/i18n.svelte';
  import { stepValue } from '../../lib/workout/steps';

  /**
   * A number between − and + buttons that can also be typed, for values no button reaches
   * (34.875). The field accepts a comma or a point; while it has focus, saved values don't
   * overwrite what's being typed.
   */
  let {
    value,
    step,
    label,
    unit,
    decimals = false,
    onchange,
  }: {
    value: number;
    step: number;
    /** Full name, for screen readers. */
    label: string;
    /** Short name shown under the number. */
    unit: string;
    /** Allows fractions and shows the decimal keypad. */
    decimals?: boolean;
    onchange: (value: number) => void;
  } = $props();

  const display = (n: number) => n.toLocaleString(locale(), { useGrouping: false, maximumFractionDigits: 3 });

  let focused = $state(false);
  let text = $state('');

  $effect(() => {
    if (!focused) text = display(value);
  });

  function parse(input: string): number | null {
    const n = Number(input.trim().replace(',', '.'));
    if (!input.trim() || !Number.isFinite(n) || n < 0) return null;
    return decimals ? Math.round(n * 1000) / 1000 : Math.round(n);
  }

  function type(input: string) {
    text = input;
    const n = parse(input);
    if (n !== null) onchange(n);
  }

  /** iOS keeps the keyboard's focus on the field through a button tap, so the text is set here too. */
  function bump(direction: -1 | 1) {
    const next = stepValue(value, step, direction);
    text = display(next);
    onchange(next);
  }
</script>

<div class="stepper">
  <button type="button" class="bump" aria-label={t('workout.less', { label })} onclick={() => bump(-1)}>
    <Icon name="minus" size={20} />
  </button>
  <label class="value">
    <input
      type="text"
      inputmode={decimals ? 'decimal' : 'numeric'}
      autocomplete="off"
      aria-label={label}
      value={text}
      oninput={(e) => type(e.currentTarget.value)}
      onfocus={(e) => {
        focused = true;
        e.currentTarget.select();
      }}
      onblur={() => (focused = false)}
    />
    <span class="unit">{unit}</span>
  </label>
  <button type="button" class="bump" aria-label={t('workout.moreOf', { label })} onclick={() => bump(1)}>
    <Icon name="plus" size={20} />
  </button>
</div>

<style>
  .stepper {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 4px;
  }
  .bump {
    display: grid;
    place-items: center;
    height: 50px;
    border: 0;
    border-radius: 12px;
    background: var(--surface-3);
    color: var(--text);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    transition: transform var(--dur-fast) var(--ease);
  }
  .bump:active {
    transform: scale(0.94);
    background: var(--accent-soft);
  }
  .value {
    min-width: 0;
    height: 50px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .value:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }
  input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-display);
    /* 16px or more, so iOS doesn't zoom in on focus. */
    font-size: 19px;
    font-weight: 800;
    line-height: 1.15;
    text-align: center;
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  .unit {
    font-size: 11px;
    font-weight: 600;
    line-height: 1.1;
    text-align: center;
    color: var(--muted);
  }
</style>
