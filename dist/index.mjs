function noop() { }
function assign(tar, src) {
    // @ts-ignore
    for (const k in src)
        tar[k] = src[k];
    return tar;
}
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function subscribe(store, callback) {
    const unsub = store.subscribe(callback);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function component_subscribe(component, store, callback) {
    component.$$.on_destroy.push(subscribe(store, callback));
}
function create_slot(definition, ctx, fn) {
    if (definition) {
        const slot_ctx = get_slot_context(definition, ctx, fn);
        return definition[0](slot_ctx);
    }
}
function get_slot_context(definition, ctx, fn) {
    return definition[1]
        ? assign({}, assign(ctx.$$scope.ctx, definition[1](fn ? fn(ctx) : {})))
        : ctx.$$scope.ctx;
}
function get_slot_changes(definition, ctx, changed, fn) {
    return definition[1]
        ? assign({}, assign(ctx.$$scope.changed || {}, definition[1](fn ? fn(changed) : {})))
        : ctx.$$scope.changed || {};
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function element(name) {
    return document.createElement(name);
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function afterUpdate(fn) {
    get_current_component().$$.after_update.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
}
function getContext(key) {
    return get_current_component().$$.context.get(key);
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function tick() {
    schedule_update();
    return resolved_promise;
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
function flush() {
    const seen_callbacks = new Set();
    do {
        // first, call beforeUpdate functions
        // and update components
        while (dirty_components.length) {
            const component = dirty_components.shift();
            set_current_component(component);
            update(component.$$);
        }
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                callback();
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
}
function update($$) {
    if ($$.fragment) {
        $$.update($$.dirty);
        run_all($$.before_update);
        $$.fragment.p($$.dirty, $$.ctx);
        $$.dirty = null;
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
}
function mount_component(component, target, anchor) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment.m(target, anchor);
    // onMount happens before the initial afterUpdate
    add_render_callback(() => {
        const new_on_destroy = on_mount.map(run).filter(is_function);
        if (on_destroy) {
            on_destroy.push(...new_on_destroy);
        }
        else {
            // Edge case - component was destroyed immediately,
            // most likely as a result of a binding initialising
            run_all(new_on_destroy);
        }
        component.$$.on_mount = [];
    });
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    if (component.$$.fragment) {
        run_all(component.$$.on_destroy);
        component.$$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        component.$$.on_destroy = component.$$.fragment = null;
        component.$$.ctx = {};
    }
}
function make_dirty(component, key) {
    if (!component.$$.dirty) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty = blank_object();
    }
    component.$$.dirty[key] = true;
}
function init(component, options, instance, create_fragment, not_equal, prop_names) {
    const parent_component = current_component;
    set_current_component(component);
    const props = options.props || {};
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props: prop_names,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty: null
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, props, (key, value) => {
            if ($$.ctx && not_equal($$.ctx[key], $$.ctx[key] = value)) {
                if ($$.bound[key])
                    $$.bound[key](value);
                if (ready)
                    make_dirty(component, key);
            }
        })
        : props;
    $$.update();
    ready = true;
    run_all($$.before_update);
    $$.fragment = create_fragment($$.ctx);
    if (options.target) {
        if (options.hydrate) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment.l(children(options.target));
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor);
        flush();
    }
    set_current_component(parent_component);
}
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set() {
        // overridden by instance, if it has props
    }
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

/* src/Tabs.svelte generated by Svelte v3.7.1 */

function create_fragment(ctx) {
	var div, current, dispose;

	const default_slot_template = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_template, ctx, null);

	return {
		c() {
			div = element("div");

			if (default_slot) default_slot.c();

			attr(div, "class", "svelte-tabs");
			dispose = listen(div, "keydown", ctx.handleKeyDown);
		},

		l(nodes) {
			if (default_slot) default_slot.l(div_nodes);
		},

		m(target, anchor) {
			insert(target, div, anchor);

			if (default_slot) {
				default_slot.m(div, null);
			}

			current = true;
		},

		p(changed, ctx) {
			if (default_slot && default_slot.p && changed.$$scope) {
				default_slot.p(
					get_slot_changes(default_slot_template, ctx, changed, null),
					get_slot_context(default_slot_template, ctx, null)
				);
			}
		},

		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},

		o(local) {
			transition_out(default_slot, local);
			current = false;
		},

		d(detaching) {
			if (detaching) {
				detach(div);
			}

			if (default_slot) default_slot.d(detaching);
			dispose();
		}
	};
}

const TABS = {};

function removeAndUpdateSelected(obj, item, selectedStore) {
  delete obj[item];
  //todo: need a way to get a visible tab and add it as selected here
  // selectedStore.update(selected => selected === item ? (obj[item] || obj[obj.length - 1]) : selected);
}

function registerItem(obj, item, selectedStore) {
  obj[item.id] = item;
  selectedStore.update(selected => selected || item);
  onDestroy(() => removeAndUpdateSelected(obj, item));
}

function instance($$self, $$props, $$invalidate) {
	let $selectedTab;

	

  let { selectedTabId = 'region-0', setCurrentRegionId } = $$props;

  const tabElements = [];
  const tabs = {};
  const panels = {};

  const controls = writable({});
  const labeledBy = writable({});

  const selectedTab = writable(null); component_subscribe($$self, selectedTab, $$value => { $selectedTab = $$value; $$invalidate('$selectedTab', $selectedTab); });
  const selectedPanel = writable(null);

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

	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ('selectedTabId' in $$props) $$invalidate('selectedTabId', selectedTabId = $$props.selectedTabId);
		if ('setCurrentRegionId' in $$props) $$invalidate('setCurrentRegionId', setCurrentRegionId = $$props.setCurrentRegionId);
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	$$self.$$.update = ($$dirty = { selectedTabId: 1 }) => {
		if ($$dirty.selectedTabId) ;
	};

	return {
		selectedTabId,
		setCurrentRegionId,
		selectedTab,
		handleKeyDown,
		$$slots,
		$$scope
	};
}

class Tabs extends SvelteComponent {
	constructor(options) {
		super();
		init(this, options, instance, create_fragment, safe_not_equal, ["selectedTabId", "setCurrentRegionId"]);
	}
}

/* src/Tab.svelte generated by Svelte v3.7.1 */

function add_css() {
	var style = element("style");
	style.id = 'svelte-220rvi-style';
	style.textContent = ".svelte-tabs__tab.svelte-220rvi{border:none;border-bottom:2px solid transparent;color:#000000;cursor:pointer;list-style:none;display:inline-block;padding:0.5em 0.75em}.svelte-tabs__tab.svelte-220rvi:focus{outline:thin dotted}.svelte-tabs__selected.svelte-220rvi{border-bottom:2px solid #4F81E5;color:#4F81E5}";
	append(document.head, style);
}

function create_fragment$1(ctx) {
	var li, li_id_value, li_aria_controls_value, li_tabindex_value, current, dispose;

	const default_slot_template = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_template, ctx, null);

	return {
		c() {
			li = element("li");

			if (default_slot) default_slot.c();

			attr(li, "role", "tab");
			attr(li, "id", li_id_value = ctx.tab.id);
			attr(li, "aria-controls", li_aria_controls_value = ctx.$controls[ctx.tab.id]);
			attr(li, "aria-selected", ctx.isSelected);
			attr(li, "tabindex", li_tabindex_value = ctx.isSelected ? 0 : -1);
			attr(li, "class", "svelte-tabs__tab svelte-220rvi");
			toggle_class(li, "svelte-tabs__selected", ctx.isSelected);
			dispose = listen(li, "click", ctx.click_handler);
		},

		l(nodes) {
			if (default_slot) default_slot.l(li_nodes);
		},

		m(target, anchor) {
			insert(target, li, anchor);

			if (default_slot) {
				default_slot.m(li, null);
			}

			ctx.li_binding(li);
			current = true;
		},

		p(changed, ctx) {
			if (default_slot && default_slot.p && changed.$$scope) {
				default_slot.p(
					get_slot_changes(default_slot_template, ctx, changed, null),
					get_slot_context(default_slot_template, ctx, null)
				);
			}

			if ((!current || changed.$controls) && li_aria_controls_value !== (li_aria_controls_value = ctx.$controls[ctx.tab.id])) {
				attr(li, "aria-controls", li_aria_controls_value);
			}

			if (!current || changed.isSelected) {
				attr(li, "aria-selected", ctx.isSelected);
			}

			if ((!current || changed.isSelected) && li_tabindex_value !== (li_tabindex_value = ctx.isSelected ? 0 : -1)) {
				attr(li, "tabindex", li_tabindex_value);
			}

			if (changed.isSelected) {
				toggle_class(li, "svelte-tabs__selected", ctx.isSelected);
			}
		},

		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},

		o(local) {
			transition_out(default_slot, local);
			current = false;
		},

		d(detaching) {
			if (detaching) {
				detach(li);
			}

			if (default_slot) default_slot.d(detaching);
			ctx.li_binding(null);
			dispose();
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let $selectedTab, $controls;

	

  let { regionId } = $$props;

  let tabEl;

  const tab = {
    id: regionId
  };
  const { registerTab, registerTabElement, selectTab, selectedTab, controls } = getContext(TABS); component_subscribe($$self, selectedTab, $$value => { $selectedTab = $$value; $$invalidate('$selectedTab', $selectedTab); }); component_subscribe($$self, controls, $$value => { $controls = $$value; $$invalidate('$controls', $controls); });

  let isSelected;

  registerTab(tab);

  onMount(async () => {
    await tick();
    registerTabElement(tabEl);
  });

	let { $$slots = {}, $$scope } = $$props;

	function li_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			$$invalidate('tabEl', tabEl = $$value);
		});
	}

	function click_handler() {
		return selectTab(tab);
	}

	$$self.$set = $$props => {
		if ('regionId' in $$props) $$invalidate('regionId', regionId = $$props.regionId);
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	$$self.$$.update = ($$dirty = { $selectedTab: 1 }) => {
		if ($$dirty.$selectedTab) { $$invalidate('isSelected', isSelected = $selectedTab === tab); }
	};

	return {
		regionId,
		tabEl,
		tab,
		selectTab,
		selectedTab,
		controls,
		isSelected,
		$controls,
		li_binding,
		click_handler,
		$$slots,
		$$scope
	};
}

class Tab extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-220rvi-style")) add_css();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, ["regionId"]);
	}
}

/* src/TabList.svelte generated by Svelte v3.7.1 */

function add_css$1() {
	var style = element("style");
	style.id = 'svelte-12yby2a-style';
	style.textContent = ".svelte-tabs__tab-list.svelte-12yby2a{border-bottom:1px solid #CCCCCC;margin:0;padding:0}";
	append(document.head, style);
}

function create_fragment$2(ctx) {
	var ul, current;

	const default_slot_template = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_template, ctx, null);

	return {
		c() {
			ul = element("ul");

			if (default_slot) default_slot.c();

			attr(ul, "role", "tablist");
			attr(ul, "class", "svelte-tabs__tab-list svelte-12yby2a");
		},

		l(nodes) {
			if (default_slot) default_slot.l(ul_nodes);
		},

		m(target, anchor) {
			insert(target, ul, anchor);

			if (default_slot) {
				default_slot.m(ul, null);
			}

			current = true;
		},

		p(changed, ctx) {
			if (default_slot && default_slot.p && changed.$$scope) {
				default_slot.p(
					get_slot_changes(default_slot_template, ctx, changed, null),
					get_slot_context(default_slot_template, ctx, null)
				);
			}
		},

		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},

		o(local) {
			transition_out(default_slot, local);
			current = false;
		},

		d(detaching) {
			if (detaching) {
				detach(ul);
			}

			if (default_slot) default_slot.d(detaching);
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	return { $$slots, $$scope };
}

class TabList extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-12yby2a-style")) add_css$1();
		init(this, options, instance$2, create_fragment$2, safe_not_equal, []);
	}
}

/* src/TabPanel.svelte generated by Svelte v3.7.1 */

function add_css$2() {
	var style = element("style");
	style.id = 'svelte-epfyet-style';
	style.textContent = ".svelte-tabs__tab-panel.svelte-epfyet{margin-top:0.5em}";
	append(document.head, style);
}

// (28:1) {#if $selectedPanel === panel}
function create_if_block(ctx) {
	var current;

	const default_slot_template = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_template, ctx, null);

	return {
		c() {
			if (default_slot) default_slot.c();
		},

		l(nodes) {
			if (default_slot) default_slot.l(nodes);
		},

		m(target, anchor) {
			if (default_slot) {
				default_slot.m(target, anchor);
			}

			current = true;
		},

		p(changed, ctx) {
			if (default_slot && default_slot.p && changed.$$scope) {
				default_slot.p(
					get_slot_changes(default_slot_template, ctx, changed, null),
					get_slot_context(default_slot_template, ctx, null)
				);
			}
		},

		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},

		o(local) {
			transition_out(default_slot, local);
			current = false;
		},

		d(detaching) {
			if (default_slot) default_slot.d(detaching);
		}
	};
}

function create_fragment$3(ctx) {
	var div, div_id_value, div_aria_labelledby_value, current;

	var if_block = (ctx.$selectedPanel === ctx.panel) && create_if_block(ctx);

	return {
		c() {
			div = element("div");
			if (if_block) if_block.c();
			attr(div, "id", div_id_value = ctx.panel.id);
			attr(div, "aria-labelledby", div_aria_labelledby_value = ctx.$labeledBy[ctx.panel.id]);
			attr(div, "class", "svelte-tabs__tab-panel svelte-epfyet");
			attr(div, "role", "tabpanel");
		},

		m(target, anchor) {
			insert(target, div, anchor);
			if (if_block) if_block.m(div, null);
			current = true;
		},

		p(changed, ctx) {
			if (ctx.$selectedPanel === ctx.panel) {
				if (if_block) {
					if_block.p(changed, ctx);
					transition_in(if_block, 1);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(div, null);
				}
			} else if (if_block) {
				group_outros();
				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});
				check_outros();
			}

			if ((!current || changed.$labeledBy) && div_aria_labelledby_value !== (div_aria_labelledby_value = ctx.$labeledBy[ctx.panel.id])) {
				attr(div, "aria-labelledby", div_aria_labelledby_value);
			}
		},

		i(local) {
			if (current) return;
			transition_in(if_block);
			current = true;
		},

		o(local) {
			transition_out(if_block);
			current = false;
		},

		d(detaching) {
			if (detaching) {
				detach(div);
			}

			if (if_block) if_block.d();
		}
	};
}

function instance$3($$self, $$props, $$invalidate) {
	let $labeledBy, $selectedPanel;

	

  let { regionId } = $$props;

  const panel = {
    id: regionId
  };
  const {registerPanel, selectedPanel, labeledBy} = getContext(TABS); component_subscribe($$self, selectedPanel, $$value => { $selectedPanel = $$value; $$invalidate('$selectedPanel', $selectedPanel); }); component_subscribe($$self, labeledBy, $$value => { $labeledBy = $$value; $$invalidate('$labeledBy', $labeledBy); });

  registerPanel(panel);

	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ('regionId' in $$props) $$invalidate('regionId', regionId = $$props.regionId);
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	return {
		regionId,
		panel,
		selectedPanel,
		labeledBy,
		$labeledBy,
		$selectedPanel,
		$$slots,
		$$scope
	};
}

class TabPanel extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-epfyet-style")) add_css$2();
		init(this, options, instance$3, create_fragment$3, safe_not_equal, ["regionId"]);
	}
}

export { Tab, TabList, TabPanel, Tabs };
