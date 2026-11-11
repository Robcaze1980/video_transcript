import { uploadPrivateVideo } from './pilotUpload.js';
import { createDriveUploader } from './pilotDrive.js';
import { corePilotLocales, formatVideoPackage, pilotLocale, pilotLocales, panelText } from './pilotLocales.js';

const el = id => document.getElementById(id);
let storedLocale;
try { storedLocale = localStorage.getItem('linguistvision-pilot-language'); } catch {}
const requestedLocale = new URLSearchParams(location.search).get('lang');
const enabledLocales = document.documentElement.dataset.launchLanguagePreview === 'true' ? pilotLocales : corePilotLocales;
const knownLocale = id => enabledLocales.some(item => item.id === id);
let locale = pilotLocale(knownLocale(requestedLocale) ? requestedLocale : knownLocale(storedLocale) ? storedLocale : 'es');
const t = (key, ...values) => locale.text(key, ...values);
let currentMessage;
let jobState;
let account;
let cloudExport;
let cloudUid;
const fileMaximum = () => account?.uploads?.maxBytes ?? 1048576;
const durationMaximum = () => account?.uploads?.maxSeconds ?? 30;
function validateVideoFile(file) {
  if (!file || file.size > fileMaximum()) {
    if (account?.uploads) throw new Error(locale.id === 'es' ? 'Selecciona un MP4 de hasta ' + Math.round(fileMaximum()/1000000) + ' MB.' : 'Select an MP4 up to ' + Math.round(fileMaximum()/1000000) + ' MB.');
    throw Object.assign(new Error(), {key: 'fileLimit'});
  }
}
function largeLabels() {
  if (!account?.uploads) return;
  const number = new Intl.NumberFormat(locale.tag);
  const limit = Math.round(fileMaximum()/1000000) + ' MB · ' + durationMaximum() + ' s · MP4';
  for (const node of document.querySelectorAll('[data-panel-text="limits"], [data-text="projectHelp"]')) node.textContent =
    (locale.id === 'es' ? 'Prueba de archivos grandes: ' : 'Large-file preview: ') + limit + ' · ' + account.uploads.retentionHours + ' h';
  document.querySelector('[data-text="file"]').textContent = t('projectVideo') + ' · ' + limit;
}
async function uploadLarge(file, cancelButton) {
  validateVideoFile(file);
  const controller = new AbortController();
  const button = el(cancelButton);
  const cancel = () => controller.abort();
  button.hidden = false; button.addEventListener('click', cancel);
  try { return await uploadPrivateVideo(file, { signal: controller.signal, context: account.uploads.scope,
    chunkBytes: account.uploads.chunkBytes, onProgress: progress => message('', t('uploadProgress', Math.round(progress*100))) }); }
  finally { button.hidden = true; button.removeEventListener('click', cancel); }
}
async function prepareCloudExport() {
  if (!account?.drive?.uid || cloudUid === account.drive.uid) return;
  const { prepareDriveAuthorization } = await import('./editor-assets/driveAuthorization.js');
  const authorize = await prepareDriveAuthorization(account.drive.uid);
  let token;
  const uploader = createDriveUploader({ getAccessToken: () => token });
  cloudExport?.clear(); cloudUid = account.drive.uid;
  cloudExport = {
    authorize: async () => { token = await authorize(); },
    save: (blob, name, exportKey, signal, progress) => uploader.upload({ blob, name, exportKey, signal,
      onProgress: ({uploaded,total}) => progress(uploaded/total) }),
    clear: () => { token = undefined; uploader.clear(); },
  };
}
let balanceFresh = false;
let historyFresh = false;
let submitting = false;
let recentJobs = [];
let recentProjects = [];
let activeView = 'home';
let wizardStep = 1;
let previewDuration;
let previewUrl;
let navigationReady = false;
const pt = key => panelText(locale.id, key);
function panelLabels() {
  for (const node of document.querySelectorAll('[data-panel-text]')) node.textContent = pt(node.dataset.panelText);
  el('account-login-link').href = './sign-in/?lang=' + locale.id;
  el('workspace').querySelector('nav').setAttribute('aria-label', pt('account'));
}
function balanceTime(seconds) {
  if (!Number.isFinite(seconds)) return pt('unavailable');
  return new Intl.NumberFormat(locale.tag, { useGrouping: false }).format(Math.floor(seconds / 60)) + ':' +
    new Intl.NumberFormat(locale.tag, { minimumIntegerDigits: 2, useGrouping: false }).format(seconds % 60);
}
function syncPanels() {
  if (!account) return;
  const visibility = {
    'home-panel': activeView === 'home', 'balance-panel': activeView === 'balance',
    'account-panel': activeView === 'account', 'projects': account.subtitleProjects && ['projects', 'import'].includes(activeView),
    'project-import-panel': activeView === 'import', 'job': activeView === 'create' && services.length,
    'project-review': activeView === 'editor' && Boolean(editor?.projectId),
    'result': activeView === 'result' || (activeView === 'editor' && editor && !editor.projectId),
    'history': activeView === 'projects' && recentJobs.length,
  };
  for (const [id, visible] of Object.entries(visibility)) el(id).hidden = !visible;
  el('workspace').dataset.view = activeView;
  for (const button of document.querySelectorAll('.workspace-nav [data-view]')) {
    if (button.dataset.view === activeView) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
function goView(view, focus = true) {
  if (!['home','projects','balance','account','create','import','editor','result'].includes(view) || submitting) return;
  if (view !== activeView && !['editor','result'].includes(view) && !allowCloseEditor()) return;
  if (view !== activeView && !['editor','result'].includes(view)) closeEditor();
  activeView = view;
  history.replaceState(null, '', location.pathname + location.search + '#' + view);
  syncPanels();
  if (focus) {
    const heading = el('workspace').querySelector('.panel-view:not([hidden]) h1, .panel-view:not([hidden]) h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    el('workspace').scrollIntoView({ block: 'start' });
  }
}
function setWizard(step) {
  wizardStep = step;
  el('create-file-step').hidden = step !== 1;
  el('create-language-step').hidden = step !== 2;
  el('create-summary-step').hidden = step !== 3;
  el('wizard-back').hidden = step === 1;
  el('wizard-next').hidden = step === 3;
  el('submit-job').hidden = step !== 3;
  el('wizard-step').textContent = [1,2,3].map(n => (n === step ? '● ' : '') + n).join(' / ');
  if (step === 3) {
    const file = el('file').files[0];
    const service = services.find(item => item.key === el('service').value);
    const rows = [[pt('fileName'), file?.name || '—'], [pt('duration'), previewDuration === undefined ? pt('unavailable') : previewDuration.toFixed(3) + ' s'],
      [t('service'), serviceLabel(service)], [t('direction'), !el('launch-language-fields').hidden ? directionLanguage(launchPair().source) + ' → ' + directionLanguage(launchPair().target) : el('direction').selectedOptions[0]?.textContent || '—'],
      [pt('available'), !balanceFresh ? pt('unavailable') : account?.packages ? balanceTime(account.balance.available) : String(account?.balance.available ?? '—')]];
    const list = el('create-summary'); list.replaceChildren();
    for (const [label, value] of rows) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); const bdi = document.createElement('bdi'); bdi.textContent = value; dd.append(bdi); list.append(dt, dd);
    }
  }
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  const view = button.dataset.view;
  if (view === 'create') setWizard(1);
  goView(view);
});
el('wizard-next').addEventListener('click', event => void action(event.currentTarget, async () => {
  if (wizardStep === 1) {
    const file = el('file').files[0];
    validateVideoFile(file);
    if (el('service').value.startsWith('video-to-srt:')) {
      previewDuration = await readDuration(file);
      if (!Number.isFinite(previewDuration) || previewDuration <= 0 || previewDuration > durationMaximum()) throw new Error('MP4 · '+durationMaximum()+' s max.');
    }
  }
  setWizard(Math.min(3, wizardStep + 1));
}));
el('wizard-back').addEventListener('click', () => setWizard(Math.max(1, wizardStep - 1)));

const message = (key, fallback = '') => {
  currentMessage = { key, fallback };
  el('message').textContent = key ? t(key) : fallback;
};
const showError = error => message(error.key, error.message || t('unavailable'));
const showJobState = state => {
  jobState = state;
  el('jobStatus').textContent = t(state);
  el('cancel-job').hidden = !['queued', 'running'].includes(state);
  el('retry-job').hidden = !['failed', 'cancelled'].includes(state);
};
let paymentId;
let pendingInput;
let timer;
let displayedJob;
let jobRequest = 0;
let editor;
let editorRequest = 0;
let services = [];
const terminal = new Set(['succeeded', 'failed', 'cancelled']);

async function api(path, body, raw = false) {
  const multipart = body instanceof FormData;
  const response = await fetch('./api/' + path, body === undefined ? {} : {
    method: 'POST',
    headers: multipart ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: raw || multipart ? body : JSON.stringify(body)
  });
  return apiResult(path, response.status, await response.json());
}

function apiResult(path, status, data) {
  if (status < 200 || status >= 300) {
    const key = status === 401 ? (path === 'login' ? 'invalidInvitation' : 'signInAgain')
      : data?.key || ({ 402: 'insufficient', 413: 'fileLimit', 429: 'rateLimit' })[status];
    throw Object.assign(new Error(locale.id === 'es' && data?.error ? data.error : t('unavailable')), { key });
  }
  return data;
}

function upload(path, body, cancelButton) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const button = el(cancelButton);
    const abort = () => request.abort();
    const finish = () => {
      button.hidden = true;
      button.removeEventListener('click', abort);
    };
    request.open('POST', './api/' + path);
    request.responseType = 'json';
    if (!(body instanceof FormData)) request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.upload.onprogress = event => {
      if (event.lengthComputable) message('', t('uploadProgress', Math.round(event.loaded / event.total * 100)));
    };
    request.upload.onloadend = finish;
    request.onload = () => {
      try { resolve(apiResult(path, request.status, request.response)); } catch (error) { reject(error); }
    };
    request.onerror = () => reject(Object.assign(new Error(), { key: 'unavailable' }));
    request.onabort = () => reject(Object.assign(new Error(), { key: 'uploadCancelled' }));
    request.onloadend = finish;
    button.hidden = false;
    button.addEventListener('click', abort);
    request.send(body);
  });
}

function syncService() {
  const service = services.find(item => item.key === el('service').value);
  if (!service) return;
  el('file').accept = service.accepts;
  const preview = Boolean(account.launchLanguagePreview && service.key.startsWith('video-to-srt:'));
  el('launch-language-fields').hidden = !preview;
  el('directionFields').hidden = true;
  el('independent-fields').hidden = preview || !service.directions?.length;
  const previous = el('direction').value;
  el('direction').replaceChildren(...(service.directions ?? []).map(item =>
    new Option(t(item.id) === item.id ? item.label : t(item.id), item.id, false, item.id === previous)));
  if (preview) {
    for (const id of ['launch-source', 'launch-target']) {
      const select = el(id);
      const preferred = select.value || (id === 'launch-source' ? 'en' : 'es');
      select.replaceChildren(...account.launchLanguagePreview.map(language => {
        const option = new Option(language.name, language.id, false, language.id === preferred);
        option.lang = language.locale;
        return option;
      }));
    }
  }
  syncIndependentPair(service);
  syncLaunchPair(service);
}

function directionLanguage(id) {
  try { return new Intl.DisplayNames([locale.tag], { type: 'language' }).of(id === 'cmn' ? 'zh' : id); }
  catch { return id; }
}
function syncIndependentPair(service, sourceChanged = false) {
  if (el('independent-fields').hidden) return;
  const directions = service.directions ?? [];
  const selected = directions.find(item => item.id === el('direction').value) ?? directions[0];
  const source = sourceChanged ? el('choose-source').value : selected?.id.split('-')[0];
  const sources = [...new Set(directions.map(item => item.id.split('-')[0]))];
  el('choose-source').replaceChildren(...sources.map(id => new Option(directionLanguage(id), id, false, id === source)));
  const matches = directions.filter(item => item.id.startsWith(source + '-'));
  el('choose-target').replaceChildren(...matches.map(item => {
    const id = item.id.split('-')[1];
    return new Option(directionLanguage(id), item.id, false, item.id === selected?.id);
  }));
  el('direction').value = el('choose-target').value;
  const effective = directions.find(item => item.id === el('direction').value);
  el('effective-pair-status').textContent = t(effective?.status === 'verified' ? 'pairVerified' : 'pairBeta');
}
el('choose-source').addEventListener('change', () => {
  pendingInput = undefined;
  syncIndependentPair(services.find(item => item.key === el('service').value), true);
});
el('choose-target').addEventListener('change', () => {
  pendingInput = undefined;
  el('direction').value = el('choose-target').value;
  syncIndependentPair(services.find(item => item.key === el('service').value));
});

function launchPair() {
  return { source: el('launch-source').value, target: el('launch-target').value };
}

function syncLaunchPair(service = services.find(item => item.key === el('service').value)) {
  const preview = !el('launch-language-fields').hidden;
  const { source, target } = launchPair();
  const direction = service?.directions?.find(item => item.id === source + '-' + target);
  const status = direction?.status === 'verified' ? 'pairVerified' : direction ? 'pairBeta' : 'pairRequest';
  const blocked = (preview && !direction) || !balanceFresh;
  el('launch-pair-status').textContent = preview ? t(status) : '';
  el('request-language').hidden = !blocked;
  el('submit-job').disabled = blocked;
  el('file').disabled = blocked;
}

function serviceLabel(service) {
  if (service?.key.startsWith('video-to-srt:')) return t('videoService');
  if (service?.key.startsWith('pdf-to-csv:')) return t('pdfService');
  return service?.label || t('job');
}

function renderAccount() {
  if (!account) return;
  if (!balanceFresh) {
    for (const id of ['balance','nav-balance','home-balance','home-reserved','header-balance-value']) el(id).textContent = pt('unavailable');
    el('checkout').disabled = true; el('submit-job').disabled = true;
    return;
  }
  el('checkout').disabled = false;
  el('login').hidden = true;
  el('workspace').hidden = false;
  const { available, reserved } = account.balance;
  if (account.packages) {
    const number = new Intl.NumberFormat(locale.tag, { useGrouping: false });
    const second = new Intl.NumberFormat(locale.tag, { minimumIntegerDigits: 2 });
    const time = seconds => '\u2066' + number.format(Math.floor(seconds / 60)) + ':' + second.format(seconds % 60) + '\u2069';
    el('balance-title').textContent = t('videoBalance');
    el('balance').textContent = t('balanceTime', time(available), time(reserved));
    el('checkout').textContent = t('topUp');
    el('submit-job').textContent = t('processByTime');
    const select = el('package');
    const selected = select.value;
    select.replaceChildren(...account.packages.map(pack =>
      new Option(formatVideoPackage(locale.tag, pack), pack.id, false, pack.id === selected)));
  } else {
    el('balance').textContent = t('balance', available, reserved);
  }
  el('packages').hidden = !account.packages;
  el('job').hidden = !account.services.length;
  el('mode').textContent = t(account.paymentMode === 'simulated' ? 'simulated' : 'sandbox').replace('PayPal Sandbox', 'PayPal');
  el('projects').hidden = !account.subtitleProjects;
  const formatted = account.packages ? balanceTime(available) : String(available);
  el('nav-balance').textContent = formatted;
  el('home-balance').textContent = formatted;
  el('header-balance').hidden = false;
  el('header-balance-value').textContent = formatted;
  el('home-reserved').textContent = account.packages ? t('balanceTime', formatted, balanceTime(reserved)) : t('balance', available, reserved);
  syncLaunchPair();
  syncPanels();
  largeLabels();
}

function renderServices() {
  const selected = el('service').value;
  el('service').replaceChildren(...services.map(service =>
    new Option(serviceLabel(service), service.key, false, service.key === selected)));
  syncService();
}

async function refresh() {
  try { account = await api('account'); balanceFresh = true; }
  catch (error) {
    balanceFresh = false; renderAccount();
    for (const id of ['balance','nav-balance','home-balance','home-reserved','header-balance-value']) el(id).textContent = pt('unavailable');
    throw error;
  }
  if (!services.length) {
    services = account.services;
    renderServices();
  }
  await prepareCloudExport().catch(() => {});
  renderAccount();
  if (!navigationReady) {
    navigationReady = true;
    const requested = location.hash.slice(1);
    goView(['home','projects','balance','account','create','import'].includes(requested) ? requested : 'home', false);
  }
  return account.balance;
}

async function refreshHistory() {
  try {
    [recentJobs, recentProjects] = await Promise.all([
      api('jobs'), account?.subtitleProjects ? api('projects') : [],
    ]);
  } catch (error) {
    historyFresh = false; renderProjects(); renderHistory();
    for (const id of ['home-empty', 'projects-empty']) { el(id).hidden = false; el(id).textContent = pt('unavailable'); }
    throw error;
  }
  historyFresh = true;
  el('home-empty').textContent = pt('empty');
  el('projects-empty').textContent = pt('empty');
  renderHistory();
  renderProjects();
}

function renderProjects() {
  if (!historyFresh) {
    el('home-projects').replaceChildren(); el('project-list').replaceChildren();
    for (const id of ['home-empty','projects-empty']) { el(id).textContent = pt('unavailable'); el(id).hidden = false; }
    return;
  }
  const entries = recentProjects.map(project => {
    const item = document.createElement('li');
    const name = document.createElement('bdi');
    name.textContent = project.name;
    const expires = new Intl.DateTimeFormat(locale.tag, { dateStyle: 'short', timeStyle: 'short' })
      .format(new Date(project.expires_at));
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = t('projectOpen');
    open.addEventListener('click', () => {
      if (allowCloseEditor()) void action(open, () => openEditor(project.id, true));
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = t('projectDelete');
    remove.addEventListener('click', () => void action(remove, async () => {
      if (!window.confirm(t('projectDeleteConfirm'))) return;
      await api('projects/' + project.id + '/delete', {});
      if (editor?.projectId === project.id) closeEditor();
      await refreshHistory();
      message('projectDeleted');
    }));
    item.append(name, ' · ', t('projectExpires', expires), ' ', open, ' ', remove);
    return item;
  });
  el('project-list').replaceChildren(...entries);
  el('project-list').hidden = !entries.length;
  el('projects-empty').hidden = Boolean(entries.length);
  el('home-empty').hidden = Boolean(entries.length);
  el('home-projects').replaceChildren(...recentProjects.slice(0, 3).map(project => {
    const item = document.createElement('li');
    const name = document.createElement('bdi'); name.textContent = project.name;
    const open = document.createElement('button'); open.type = 'button'; open.className = 'secondary'; open.textContent = t('projectOpen');
    open.addEventListener('click', () => { if (allowCloseEditor()) void action(open, () => openEditor(project.id, true)); });
    item.append(name, open); return item;
  }));
}

function renderHistory() {
  if (!historyFresh) {
    const item = document.createElement('li'); item.textContent = pt('unavailable');
    el('historyList').replaceChildren(item); syncPanels(); return;
  }
  const entries = recentJobs.map(job => {
    const item = document.createElement('li');
    const service = services.find(candidate => candidate.key === job.service);
    item.textContent = serviceLabel(service) + ' · ' + t(job.state);
    if (job.state !== 'succeeded') {
      const details = document.createElement('button');
      details.type = 'button';
      details.textContent = t('jobDetails');
      details.addEventListener('click', () => {
        clearTimeout(timer);
        displayedJob = job.id;
        el('edit').hidden = true;
        el('project-from-result').hidden = true;
        el('download').hidden = true;
        activeView = 'result'; syncPanels();
        void action(details, () => showJob(job.id));
      });
      item.append(' · ', details);
    }
    if (job.downloadable) {
      const link = document.createElement('a');
      link.href = './api/jobs/' + job.id + '/download';
      link.textContent = t('download');
      item.append(' · ', link);
      if (service?.editableVideo) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = t('review');
        edit.addEventListener('click', () => {
          if (allowCloseEditor()) void action(edit, () => openEditor(job.id));
        });
        item.append(' · ', edit);
        if (account?.subtitleProjects) {
          const project = document.createElement('button');
          project.type = 'button';
          project.textContent = t('projectFromJob');
          project.addEventListener('click', () => void action(project, () => createProjectFromJob(job.id)));
          item.append(' · ', project);
        }
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = t('remove');
      remove.addEventListener('click', () => void action(remove, async () => {
        if (!window.confirm(t('confirmRemove'))) return;
        await api('jobs/' + job.id + '/delete-files', {});
        if (!editor?.projectId) {
          closeEditor();
          el('result').hidden = true;
        }
        await refreshHistory();
        message('removed');
      }));
      item.append(' · ', remove);
    }
    return item;
  });
  el('historyList').replaceChildren(...entries);
  syncPanels();
}

function applyLocale() {
  try { localStorage.setItem('linguistvision-pilot-language', locale.id); } catch {}
  document.documentElement.lang = locale.tag;
  document.documentElement.dir = locale.dir;
  document.title = t('title') + ' | LinguistVision';
  el('interface-language').value = locale.id;
  for (const node of document.querySelectorAll('[data-text]')) node.textContent = t(node.dataset.text);
  panelLabels();
  renderAccount();
  renderServices();
  renderHistory();
  renderProjects();
  if (jobState) showJobState(jobState);
  if (currentMessage) message(currentMessage.key, currentMessage.fallback);
  setWizard(wizardStep);
  editor?.setLocale(locale);
}

for (const item of enabledLocales) {
  const option = new Option(item.name, item.id);
  option.lang = item.tag;
  option.dir = item.dir;
  el('interface-language').add(option);
}
el('interface-language').addEventListener('change', () => {
  locale = pilotLocale(el('interface-language').value);
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) {
    url.searchParams.set('lang', locale.id);
    history.replaceState(null, '', url);
  }
  applyLocale();
});
applyLocale();

async function action(button, fn) {
  button.disabled = true;
  message('');
  try { await fn(); }
  catch (error) { showError(error); }
  finally { button.disabled = false; }
}

el('login').addEventListener('submit', event => {
  event.preventDefault();
  void action(event.submitter, async () => {
    await api('login', { code: el('code').value });
    el('code').value = '';
    await refresh();
    await refreshHistory();
    await handlePayPalReturn();
  });
});

el('logout').addEventListener('click', event => {
  if (!allowCloseEditor()) return;
  void action(event.currentTarget, async () => {
    cloudExport?.clear();
    await api('logout', {});
    location.reload();
  });
});

el('refresh').addEventListener('click', event => void action(event.currentTarget, refresh));
el('checkout').addEventListener('click', event => {
  if (!balanceFresh) { message('', pt('unavailable')); return; }
  const packageId = account.packages ? el('package').value : undefined;
  if (account.paypalWebCheckout) {
    const query = new URLSearchParams({ lang: locale.id });
    if (packageId) query.set('package', packageId);
    location.assign('./paypal-web/?' + query);
    return;
  }
  void action(event.currentTarget, async () => {
    const session = await api('checkout', { packageId });
    if (session.url) { location.assign(session.url); return; }
    paymentId = session.id;
    el('simulate').hidden = false;
    message('paymentPrompt');
  });
});
el('simulate').addEventListener('click', event => {
  void action(event.currentTarget, async () => {
    await api('checkout/' + paymentId + '/simulate', {});
    el('simulate').hidden = true;
    await waitForPayment(paymentId);
  });
});

async function waitForPayment(id) {
  message('paymentChecking');
  for (let i = 0; i < 24; i++) {
    const { status } = await api('checkout/' + id);
    if (status === 'credited') {
      await refresh();
      message('paymentSuccess');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  message('paymentPending');
}

async function handlePayPalReturn() {
  const params = new URLSearchParams(location.search);
  const payment = params.get('payment');
  const token = params.get('token');
  if (!payment || !/^[0-9a-f-]{36}$/i.test(payment) || !token) return;
  await api('checkout/' + payment + '/capture', { token });
  history.replaceState(null, '', location.pathname);
  await waitForPayment(payment);
}

function readDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
    };
    const fail = () => { cleanup(); reject(Object.assign(new Error(), { key: 'badDuration' })); };
    const timeout = setTimeout(fail, 8000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(duration);
    };
    video.onerror = fail;
    video.src = url;
  });
}

async function showJob(id) {
  const request = ++jobRequest;
  try {
    const job = await api('jobs/' + id);
    if (displayedJob !== id || request !== jobRequest) return;
    showJobState(job.state);
    if (job.state === 'succeeded') {
      el('download').href = './api/jobs/' + id + '/download';
      el('download').hidden = false;
      el('edit').hidden = !services.find(service => service.key === job.service)?.editableVideo;
      el('project-from-result').hidden = el('edit').hidden || !account?.subtitleProjects;
    }
    if (terminal.has(job.state)) {
      const updates = await Promise.allSettled([refresh(), refreshHistory()]);
      for (const update of updates) if (update.status === 'rejected') showError(update.reason);
    } else timer = setTimeout(() => void showJob(id), 600);
  } catch (error) {
    if (displayedJob === id && request === jobRequest) showError(error);
  }
}

function closeEditor() {
  editorRequest++;
  editor?.unmount();
  editor = undefined;
  el('project-review').hidden = true;
}

function allowCloseEditor() {
  return !editor?.hasUnsavedChanges() || window.confirm(t('projectDiscard'));
}

async function openEditor(id, project = false) {
  closeEditor();
  const request = editorRequest;
  const { mountEditor } = await import('./editor-assets/editor.js');
  if (editorRequest !== request) return;
  const path = (project ? 'projects/' : 'jobs/') + id;
  const base = './api/' + path;
  const target = el(project ? 'project-editor' : 'editor');
  editor = {
    ...mountEditor(target, base + '/source', project ? base : base + '/download', locale,
      project ? (draft, revision, originalDraft, style, highlights) =>
        api(path, { draft, revision, originalDraft, style, highlights }) : undefined,
      project ? undefined : base + '/original',
      project ? {
        list: () => api('subtitle-presets'),
        save: preset => api('subtitle-presets', preset),
        remove: name => api('subtitle-presets/delete', { name }),
      } : undefined, false, cloudExport),
    projectId: project ? id : undefined,
  };
  activeView = 'editor'; syncPanels();
  target.scrollIntoView({ block: 'nearest' });
}

el('project-import').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = new FormData(form);
  void action(event.submitter, async () => {
    let imported;
    if (account?.uploads) {
      const video = files.get('video'), srt = files.get('srt'), original = files.get('originalSrt');
      if (!(video instanceof File) || !(srt instanceof File) || !srt.size || srt.size > 65536 ||
          (original instanceof File && original.size > 65536)) throw new Error(locale.id === 'es' ? 'Selecciona video y subtítulos UTF-8 de hasta 64 KiB.' : 'Select video and UTF-8 subtitles up to 64 KiB.');
      const text = async file => new TextDecoder('utf-8', {fatal:true}).decode(await file.arrayBuffer());
      const srtText = await text(srt);
      const originalText = original instanceof File && original.size ? await text(original) : undefined;
      const { id } = await uploadLarge(video, 'cancel-project-upload');
      imported = await api('projects/from-upload', { uploadId:id, srt:srtText, srtName:srt.name,
        ...(originalText ? {originalSrt: originalText, originalName: original.name} : {}) });
    } else imported = await upload('projects', files, 'cancel-project-upload');
    const { id, converted = [] } = imported;
    form.reset();
    await refreshHistory();
    if (allowCloseEditor()) {
      await openEditor(id, true);
      if (converted.length) {
        message('', [t('projectImported'), ...converted.map(({format, count}) =>
          format.toUpperCase() + ' → SRT · ' + t('subtitleSegmentCount', count))].join(' '));
      } else message('projectImported');
    }
  });
});

async function createProjectFromJob(jobId) {
  const { id } = await api('jobs/' + jobId + '/project', {});
  await refreshHistory();
  if (allowCloseEditor()) {
    await openEditor(id, true);
    message('projectImported');
  }
}

el('project-from-result').addEventListener('click', event => {
  if (displayedJob) void action(event.currentTarget, () => createProjectFromJob(displayedJob));
});

el('edit').addEventListener('click', event => {
  if (displayedJob && allowCloseEditor()) void action(event.currentTarget, () => openEditor(displayedJob));
});

el('cancel-job').addEventListener('click', event => {
  const id = displayedJob;
  if (!id) return;
  void action(event.currentTarget, async () => {
    try { await api('jobs/' + id + '/cancel', {}); }
    finally { if (displayedJob === id) { clearTimeout(timer); await showJob(id); } }
  });
});

el('retry-job').addEventListener('click', event => {
  const id = displayedJob;
  if (!id) return;
  void action(event.currentTarget, async () => {
    const retry = await api('jobs/' + id + '/retry', {});
    if (displayedJob !== id) return;
    displayedJob = retry.id;
    try { await refresh(); } catch (error) { showError(error); }
    await showJob(retry.id);
  });
});

el('service').addEventListener('change', () => { pendingInput = undefined; syncService(); });
el('direction').addEventListener('change', () => { pendingInput = undefined; });
for (const id of ['launch-source', 'launch-target']) {
  el(id).addEventListener('change', () => { pendingInput = undefined; syncLaunchPair(); });
}
el('request-language').addEventListener('click', event => {
  const pair = launchPair();
  void action(event.currentTarget, async () => {
    await api('language-requests', pair);
    message('languageRequested');
  });
});
el('file').addEventListener('change', () => {
  pendingInput = undefined; previewDuration = undefined;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  const file = el('file').files[0];
  const preview = el('input-preview'); preview.hidden = true; preview.removeAttribute('src');
  el('input-info').textContent = file ? file.name + ' · ' + new Intl.NumberFormat(locale.tag, { maximumFractionDigits: 2 }).format(file.size / 1048576) + ' MiB' : '';
  if (file && el('service').value.startsWith('video-to-srt:')) {
    previewUrl = URL.createObjectURL(file); preview.src = previewUrl; preview.hidden = false;
  }
});
el('job').addEventListener('submit', event => {
  event.preventDefault();
  if (el('submit-job').disabled || wizardStep !== 3 || !balanceFresh || submitting) return;
  if (!allowCloseEditor()) return;
  submitting = true;
  void action(event.submitter, async () => {
    try {
    const file = el('file').files[0];
    validateVideoFile(file);
    const service = el('service').value;
    const pair = launchPair();
    const direction = el('launch-language-fields').hidden ? el('direction').value : pair.source + '-' + pair.target;
    displayedJob = undefined;
    clearTimeout(timer);
    closeEditor();
    el('edit').hidden = true;
    el('project-from-result').hidden = true;
    el('download').hidden = true;
    el('download').removeAttribute('href');
    activeView = 'result'; syncPanels();
    showJobState('preparing');
    if (!pendingInput) {
      const options = {};
      if (service.startsWith('video-to-srt:')) {
        options.duration = await readDuration(file);
        options.direction = direction;
        if (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration > durationMaximum()) throw new Error('MP4 · '+durationMaximum()+' s max.');
      }
      let id;
      try { ({ id } = account?.uploads && service.startsWith('video-to-srt:') ? await uploadLarge(file, 'cancel-job-upload') : await upload('files', file, 'cancel-job-upload')); }
      catch (error) { showJobState(error.key === 'uploadCancelled' ? 'uploadCancelled' : 'uploadFailed'); throw error; }
      pendingInput = { inputId: id, requestKey: crypto.randomUUID(), service, options };
    }
    let id;
    try { ({ id } = await api('jobs', pendingInput)); }
    catch (error) { showJobState('uploadFailed'); throw error; }
    pendingInput = undefined;
    el('file').value = '';
    displayedJob = id;
    message('');
    try { await refresh(); } catch (error) { showError(error); }
    await showJob(id);
    } finally { submitting = false; }
  });
});

void refresh().then(refreshHistory).then(handlePayPalReturn).catch(error => {
  if (!el('workspace').hidden || error.key !== 'signInAgain') showError(error);
});
