// Availability comes from server-advertised directions, independently of quality labels.
export function enabledDirections(service) {
  return (service?.directions ?? []).filter(item => item.enabled !== false && item.available !== false &&
    !['pending', 'unavailable', 'disabled'].includes(item.status));
}
export function languageChoices(service, preferredSource) {
  const directions = enabledDirections(service);
  const sources = [...new Set(directions.map(item => item.id.split('-')[0]))];
  const source = sources.includes(preferredSource) ? preferredSource : sources[0];
  const targets = [...new Set(directions.filter(item => item.id.startsWith(source + '-')).map(item => item.id.split('-')[1]))];
  return { sources, source, targets };
}
