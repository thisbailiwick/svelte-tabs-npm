<script>
  import {getContext} from 'svelte';

  import getId from './id';
  import {TABS} from './Tabs.svelte';

  export let regionId;

  const panel = {
    id: regionId
  };
  const {registerPanel, selectedPanel, labeledBy} = getContext(TABS);

  registerPanel(panel);
</script>

<style>
  .svelte-tabs__tab-panel {
    margin-top: 0.5em;
  }
</style>

<div
  id={panel.id}
  aria-labelledby={$labeledBy[panel.id]}
  class="svelte-tabs__tab-panel"
  role="tabpanel">
 {#if $selectedPanel === panel}
   <slot></slot>
 {/if}
</div>
