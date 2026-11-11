export const textPdf = () => {
  const stream = 'BT /F1 12 Tf 20 80 Td (=5, "units") Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let content = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = content.length;
    content += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    return offset.toString().padStart(10, '0') + ' 00000 n \n';
  });
  const start = content.length;
  content += 'xref\n0 6\n0000000000 65535 f \n' + offsets.join('') +
    'trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n' + start + '\n%%EOF\n';
  return Buffer.from(content, 'ascii');
};
