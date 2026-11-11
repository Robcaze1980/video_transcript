import { pilotLocale } from './pilotLocales.js';
import { mountEditor } from './editor-assets/editor.js';

const editor = document.getElementById('demo-editor');
mountEditor(editor, '/demo/jobsite.mp4', '/demo/jobsite-draft.srt', pilotLocale(editor.dataset.locale),
  undefined, undefined, undefined, true);
