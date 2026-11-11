<script lang="ts">
  import { app } from './app.svelte';

  const groups: [string, [string, string][]][] = [
    [
      'Writing',
      [
        ['Click empty space', 'New block at that spot'],
        ['Click a block', 'Edit it, caret at the click'],
        ['Enter', 'New line in the same block'],
        ['Esc / click away', 'Finish block (empty blocks vanish)'],
        ['Alt (while clicking)', 'Bypass snapping'],
        ['$…$  $$…$$', 'Inline / display math'],
        ['```lang … ```', 'Code block (Tab indents, Enter keeps indent)'],
        ['**b** *i* ==h== `c`', 'Bold, italic, highlight, code'],
        ['- item   1. item', 'Bullet / numbered lines'],
        ['Right-click a block', 'Style, copy, delete'],
        ['Ctrl/Cmd+Alt + 1…7', 'Normal, Heading, Definition, Theorem, Exercise, Note, Quote'],
        ['Ctrl/Cmd + V', 'Paste text or image at the pointer'],
      ],
    ],
    [
      'Selecting & moving',
      [
        ['Hover handle ⠿ + drag', 'Move block(s)'],
        ['Click handle', 'Select (Shift adds)'],
        ['Ctrl/Cmd + drag', 'Marquee select'],
        ['Ctrl/Cmd + A', 'Select all blocks'],
        ['Arrows (Shift = big)', 'Nudge selection'],
        ['Delete / Backspace', 'Delete selection'],
        ['Ctrl/Cmd + C', 'Copy selection (Markdown by default)'],
        ['Ctrl/Cmd+Shift + M / T / I', 'Copy as Markdown / text / image'],
      ],
    ],
    [
      'Pages & app',
      [
        ['Ctrl/Cmd + \\', 'Hide / show the pages sidebar'],
        ['Ctrl/Cmd+Shift + B', 'Back to the notebook list'],
        ['Ctrl/Cmd + N', 'New page'],
        ['Ctrl/Cmd + [  ]', 'Previous / next page'],
        ['Ctrl/Cmd + K', 'Search all notebooks'],
        ['Ctrl/Cmd+Shift + P', 'Show / hide the PDF pane'],
        ['Ctrl/Cmd+Shift + O', 'Open a PDF'],
        ['Ctrl/Cmd+Shift + L', 'Link selection to the PDF page'],
        ['← → in the PDF pane', 'Previous / next PDF page'],
        ['Ctrl/Cmd + E', 'Export menu'],
        ['Ctrl/Cmd + Z', 'Undo'],
        ['Ctrl/Cmd + Shift + Z', 'Redo'],
        ['?', 'This help'],
      ],
    ],
  ];
</script>

{#if app.help}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (app.help = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="card" role="dialog" tabindex="-1" aria-label="Keyboard shortcuts" onclick={(e) => e.stopPropagation()}>
      <h2>Keyboard shortcuts</h2>
      <div class="cols">
        {#each groups as [title, rows]}
          <section>
            <h3>{title}</h3>
            {#each rows as [k, v]}
              <div class="r"><kbd>{k}</kbd><span>{v}</span></div>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .card {
    background: var(--chrome);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 26px 24px;
    max-width: 880px;
    box-shadow: var(--shadow);
  }
  h2 {
    margin: 0 0 12px;
    font-size: 16px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, auto);
    gap: 26px;
  }
  .r {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 9px;
  }
  .r kbd {
    align-self: flex-start;
  }
  .r span {
    color: var(--muted);
    font-size: 12px;
  }
</style>
