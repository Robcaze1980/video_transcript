import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { JobAdapter } from './jobs';

const require = createRequire(import.meta.url);
const fontDirectory = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';

const csvCell = (text: string) => {
  // Some spreadsheets evaluate formula-like values even inside CSV quotes.
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
};

// Local pilot adapter: one row per page of a text-based PDF. The price is a test credit.
export const pdfToCsv: JobAdapter = {
  key: 'pdf-to-csv:v1',
  price: 1,
  validate(input, options) {
    if (input.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Expected a PDF file.');
    if (Object.keys(options).length) throw new Error('This PDF adapter does not accept options.');
  },
  async execute(input) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({
      data: new Uint8Array(input),
      standardFontDataUrl: fontDirectory,
      useSystemFonts: false,
      stopAtErrors: true,
    });
    try {
      const document = await task.promise;
      if (document.numPages > 20) throw new Error('PDF exceeds the 20-page test limit.');
      const rows = ['page,text'];
      let hasText = false;
      for (let n = 1; n <= document.numPages; n++) {
        const page = await document.getPage(n);
        try {
          const { items } = await page.getTextContent();
          const text = items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
          hasText ||= Boolean(text);
          rows.push(n + ',' + csvCell(text));
        } finally {
          page.cleanup();
        }
      }
      if (!hasText) throw new Error('The PDF contains no selectable text.');
      return Buffer.from(rows.join('\r\n') + '\r\n', 'utf8');
    } finally {
      await task.destroy();
    }
  },
};
