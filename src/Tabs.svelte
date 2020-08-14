<script context="module">
  export const TABS = {};
</script>

<script>
  import {afterUpdate, setContext, onDestroy, onMount, tick} from 'svelte';
  import {writable} from 'svelte/store';

  export let selectedTabId = 'region-0';
  export let setCurrentRegionId;

  const tabElements = [];
  const tabs = {};
  const panels = {};

  const controls = writable({});
  const labeledBy = writable({});

  const selectedTab = writable(null);
  const selectedPanel = writable(null);

  function removeAndUpdateSelected(obj, item, selectedStore) {
    delete obj[item];
    //todo: need a way to get a visible tab and add it as selected here
    // selectedStore.update(selected => selected === item ? (obj[item] || obj[obj.length - 1]) : selected);
  }

  function registerItem(obj, item, selectedStore) {
    obj[item.id] = item;
    selectedStore.update(selected => selected || item);
    onDestroy(() => removeAndUpdateSelected(obj, item, selectedStore));
  }

  function selectTab(tab) {
    setCurrentRegionId(tab.id);
    selectedTab.set(tab);
    selectedPanel.set(panels[selectedTabId]);
  }

  setContext(TABS, {
    registerTab(tab) {
      registerItem(tabs, tab, selectedTab);
    },

    registerTabElement(tabElement) {
      tabElements.push(tabElement);
    },

    registerPanel(panel) {
      registerItem(panels, panel, selectedPanel);
    },

    selectTab,

    selectedTab,
    selectedPanel,

    controls,
    labeledBy
  });

  onMount(() => {
    selectTab(tabs[selectedTabId]);
  });

  afterUpdate(() => {
    selectTab(tabs[selectedTabId]);
    for (let i = 0; i < tabs.length; i++) {
      controls.update(controlsData => ({...controlsData, [tabs[i].id]: panels[i].id}));
      labeledBy.update(labeledByData => ({...labeledByData, [panels[i].id]: tabs[i].id}));
    }
  });

  $: selectedTabId, () => {
    selectedTab.set(tabs[selectedTabId]);
    selectedPanel.set(panels[selectedTabId]);
  };

  async function handleKeyDown(event) {
    if (event.target.classList.contains('svelte-tabs__tab')) {
      let selectedIndex = tabs.indexOf($selectedTab);

      switch (event.key) {
        case 'ArrowRight':
          selectedIndex += 1;
          if (selectedIndex > tabs.length - 1) {
            selectedIndex = 0;
          }
          selectTab(tabs[selectedIndex]);
          tabElements[selectedIndex].focus();
          break;

        case 'ArrowLeft':
          selectedIndex -= 1;
          if (selectedIndex < 0) {
            selectedIndex = tabs.length - 1;
          }
          selectTab(tabs[selectedIndex]);
          tabElements[selectedIndex].focus();
      }
    }
  }
</script>

<div class="svelte-tabs" on:keydown={handleKeyDown}>
  <slot></slot>
</div>
