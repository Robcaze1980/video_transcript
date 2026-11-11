// Progressive enhancement only: all examples and FAQ answers originate in server HTML.
type Phase = { at: number; name: string };

function enhanceSequence(widget: HTMLElement, kind: 'hero' | 'how'): void {
  const canonical = document.body.classList.contains('claude-landing');
  let animationEpoch = 0;
  function restartCanonical(): void {
    if (!canonical) return;
    animationEpoch++;
    const first = kind === 'hero' ? 'A' : 'HA';
    const second = kind === 'hero' ? 'B' : 'HB';
    widget.classList.toggle(first, animationEpoch % 2 === 0);
    widget.classList.toggle(second, animationEpoch % 2 !== 0);
  }
  const targetAttribute = kind === 'hero' ? 'data-scene-target' : 'data-step-target';
  const panelAttribute = kind === 'hero' ? 'data-scene-panel' : 'data-step-panel';
  const tabs = [...widget.querySelectorAll<HTMLButtonElement>(`button[${targetAttribute}]`)];
  const panels = [...widget.querySelectorAll<HTMLElement>(`[${panelAttribute}]`)];
  const toggle = widget.querySelector<HTMLButtonElement>('[data-motion-toggle]');
  if (!tabs.length || !toggle || tabs.some(tab => !panels.some(panel => panel.getAttribute(panelAttribute) === tab.getAttribute(targetAttribute)))) return;

  const phases: Phase[] = kind === 'hero'
    ? [{ at: 0, name: 'input' }, { at: 400, name: 'line1' }, { at: 1000, name: 'review' }, { at: 2400, name: 'corrected' }, { at: 2800, name: 'line2' }, { at: 3200, name: 'result' }]
    : [0, 600, 1200, 2000, 3000, 4500].map((at, index) => ({ at, name: String(index) }));
  const duration = kind === 'hero' ? 8000 : 7000;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const suspensions = new Set<string>();
  const selectionAttribute = kind === 'hero' ? 'aria-selected' : 'aria-pressed';
  let selected = Math.max(0, tabs.findIndex(tab => tab.getAttribute(selectionAttribute) === 'true'));
  let manuallyPaused = false;
  let manualSelection = false;
  let elapsed = 0;
  let startedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function stopClock(): void {
    if (startedAt !== undefined) elapsed += performance.now() - startedAt;
    startedAt = undefined;
    clearTimeout(timer);
    timer = undefined;
  }

  function render(): void {
    const staticFrame = reduced.matches || manualSelection;
    widget.classList.toggle('manual', canonical ? kind === 'hero' && manuallyPaused : staticFrame);
    if (canonical) {
      widget.classList.toggle('hman', kind === 'how' && manuallyPaused);
      widget.dataset.animationState = suspensions.size ? 'paused' : 'running';
    }
    const running = !reduced.matches && !manuallyPaused && suspensions.size === 0;
    widget.dataset.motion = reduced.matches ? 'static' : running ? 'running' : 'paused';
    widget.dataset.phase = staticFrame ? phases[phases.length - 1].name
      : [...phases].reverse().find(phase => elapsed >= phase.at)!.name;
    tabs.forEach((tab, index) => {
      const active = index === selected;
      tab.setAttribute(selectionAttribute, String(active));
      if (kind === 'hero') tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('on', active);
      if (kind === 'hero') tab.setAttribute('aria-pressed', String(active));
      else tab.closest('li')?.classList.toggle('on', active);
    });
    const id = tabs[selected].getAttribute(targetAttribute);
    panels.forEach(panel => { panel.hidden = panel.getAttribute(panelAttribute) !== id; });
    toggle.textContent = ((manuallyPaused || reduced.matches) ? toggle.dataset.playLabel : toggle.dataset.pauseLabel) || toggle.textContent;
    toggle.setAttribute('aria-pressed', String(manuallyPaused || reduced.matches));
    toggle.disabled = reduced.matches;
  }

  function update(): void {
    stopClock();
    if (elapsed >= duration) {
      // The next scene starts its own CSS keyframes and needs a complete reading interval.
      elapsed = 0;
      selected = (selected + 1) % tabs.length;
      restartCanonical();
    }
    render();
    if (reduced.matches || manuallyPaused || suspensions.size) return;
    startedAt = performance.now();
    const next = phases.find(phase => phase.at > elapsed)?.at ?? duration;
    timer = setTimeout(update, Math.max(1, next - elapsed));
  }

  function suspend(reason: string, active: boolean): void {
    if (suspensions.has(reason) === active) return;
    if (active) suspensions.add(reason); else suspensions.delete(reason);
    update();
  }

  function select(index: number, focus: boolean): void {
    stopClock();
    selected = index;
    elapsed = 0;
    if (canonical) {
      if (kind === 'hero') manuallyPaused = true;
      manualSelection = false;
      restartCanonical();
    } else {
      manuallyPaused = true;
      manualSelection = true;
    }
    update();
    if (focus) tabs[index].focus();
  }

  tabs.forEach((tab, index) => {
    tab.disabled = false;
    tab.addEventListener('click', () => select(index, false));
    tab.addEventListener('keydown', event => {
      let next: number;
      const rtl = getComputedStyle(widget).direction === 'rtl';
      if (event.key === 'ArrowRight') next = (index + (rtl ? tabs.length - 1 : 1)) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + (rtl ? 1 : tabs.length - 1)) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      select(next, true);
    });
  });
  toggle.addEventListener('click', () => {
    if (reduced.matches) return;
    manuallyPaused = !manuallyPaused;
    if (canonical) { elapsed = 0; manualSelection = false; restartCanonical(); }
    if (!manuallyPaused && manualSelection) {
      elapsed = 0;
      manualSelection = false;
    }
    update();
  });
  if (!canonical) widget.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') suspend('hover', true); });
  if (!canonical) widget.addEventListener('pointerleave', () => suspend('hover', false));
  // The explicit playback control remains usable while focused; other focus pauses autoplay.
  const updateFocus = () => suspend('focus', !canonical && widget.contains(document.activeElement) && document.activeElement !== toggle);
  widget.addEventListener('focusin', updateFocus);
  widget.addEventListener('focusout', () => queueMicrotask(updateFocus));
  document.addEventListener('visibilitychange', () => suspend('document', document.hidden));
  // bfcache preserves this page's listeners and state; freeze its clock until restored.
  window.addEventListener('pagehide', () => suspend('page', true));
  window.addEventListener('pageshow', () => {
    suspend('document', document.hidden);
    suspend('page', false);
  });
  const updateVideo = () => suspend('video', [...document.querySelectorAll<HTMLVideoElement>('.real-demo video'), ...widget.querySelectorAll('video')].some(video => !video.paused && !video.ended));
  for (const event of ['play', 'pause', 'ended']) document.addEventListener(event, updateVideo, true);
  reduced.addEventListener('change', update);
  if ('IntersectionObserver' in window) {
    suspensions.add('viewport');
    new IntersectionObserver(entries => suspend('viewport', !entries[0].isIntersecting), { threshold: 0 }).observe(widget);
  }
  if (document.hidden) suspensions.add('document');
  widget.dataset.enhanced = 'true';
  if (kind === 'how') widget.classList.add('how-running');
  updateFocus();
  updateVideo();
  update();
}

function enhanceFaq(widget: HTMLElement): void {
  const search = widget.querySelector<HTMLInputElement>('[data-faq-search]');
  const categories = [...widget.querySelectorAll<HTMLButtonElement>('button[data-category]')];
  const answers = [...widget.querySelectorAll<HTMLDetailsElement>('details[data-faq-category]')];
  const canonicalResults = widget.querySelector<HTMLElement>('[data-faq-results]');
  const searchHeading = widget.querySelector<HTMLElement>('[data-faq-search-heading]');
  const queryLabel = widget.querySelector<HTMLElement>('[data-faq-query]');
  const empty = widget.querySelector<HTMLElement>('[data-faq-empty]');
  const clear = widget.querySelector<HTMLButtonElement>('[data-faq-clear]');
  const status = widget.querySelector<HTMLElement>('[data-faq-status]');
  const groups = [...widget.querySelectorAll<HTMLElement>('[data-faq-group]')];
  if (!search || !answers.length) return;
  let category = (categories.find(button => button.getAttribute('aria-pressed') === 'true') ?? categories[0])?.dataset.category;
  let searching = false;
  let appliedQuery = '';
  const previousOpen = new Map<HTMLDetailsElement, boolean>();
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const text = new Map(answers.map(answer => [answer, normalize(answer.textContent || '')]));
  function filter(): void {
    const query = normalize(canonicalResults ? appliedQuery : search.value.trim());
    if (query && !searching) answers.forEach(answer => previousOpen.set(answer, answer.open));
    let count = 0;
    answers.forEach(answer => {
      const matches = query ? text.get(answer)!.includes(query) : !category || category === 'all' || answer.dataset.faqCategory === category;
      answer.hidden = !matches;
      if (query && matches) answer.open = true;
      else if (!query && searching) answer.open = previousOpen.get(answer) ?? false;
      if (matches) count++;
    });
    categories.forEach(button => {
      const active = !query && button.dataset.category === category;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('on', active);
    });
    if (empty) empty.hidden = count > 0;
    groups.forEach(group => { group.hidden = !answers.some(answer => group.contains(answer) && !answer.hidden); });
    if (canonicalResults) {
      canonicalResults.replaceChildren();
      canonicalResults.hidden = !query || count === 0;
      if (searchHeading) searchHeading.hidden = !query;
      if (queryLabel) queryLabel.textContent = canonicalResults ? appliedQuery : search.value.trim();
      if (query) {
        widget.querySelectorAll<HTMLElement>('[data-faq-group]').forEach(group => { group.hidden = true; });
        answers.filter(answer => !answer.hidden).forEach((answer, index) => {
          const clone = answer.cloneNode(true) as HTMLDetailsElement;
          clone.removeAttribute('data-faq-category');
          clone.open = index === 0;
          const summary = clone.querySelector('summary')!;
          const question = summary.firstChild;
          const text = document.createElement('span');
          if (question) text.append(question);
          const label = document.createElement('span');
          label.className = 's m';
          label.textContent = categories.find(button => button.dataset.category === answer.dataset.faqCategory)?.textContent?.trim() || '';
          text.append(label);summary.prepend(text);canonicalResults.append(clone);
        });
      }
    }
    if (clear) clear.hidden = !query;
    if (status) {
      const label = (count === 1 ? status.dataset.resultSingular : undefined) || status.dataset.resultsLabel || '';
      const localizedCount = count.toLocaleString(document.documentElement.lang || undefined);
      status.textContent = query ? label.includes('{count}')
        ? label.replace(/\{count\}/g, localizedCount)
        : `${localizedCount} ${label}`.trim() : '';
    }
    searching = Boolean(query);
  }
  categories.forEach(button => button.addEventListener('click', () => {
    category = button.dataset.category;
    search.value = '';
    appliedQuery = '';
    filter();
  }));
  if (!canonicalResults) {
    search.addEventListener('input', filter);
    search.addEventListener('search', filter);
  }
  clear?.addEventListener('click', () => {
    search.value = '';
    appliedQuery = '';
    filter();
    search.focus();
  });
  search.form?.addEventListener('submit', event => { event.preventDefault(); appliedQuery = search.value.trim(); filter(); });
  widget.dataset.enhanced = 'true';
  filter();
}

document.body.dataset.js = 'true';
document.querySelectorAll<HTMLElement>('[data-hero-widget]').forEach(widget => enhanceSequence(widget, 'hero'));
document.querySelectorAll<HTMLElement>('[data-how-widget]').forEach(widget => enhanceSequence(widget, 'how'));
document.querySelectorAll<HTMLElement>('[data-faq-widget]').forEach(enhanceFaq);

document.querySelectorAll<HTMLSelectElement>('[data-site-language]').forEach(select => {
  select.addEventListener('change', () => {
    const destination = new URL(select.value, location.origin);
    if (destination.origin === location.origin) location.assign(destination.href);
  });
});
