/** Search folds accents and Vietnamese stroked D without changing the displayed copy. */
export function normalizeLandingSearch(value: string, locale?: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase(locale).replace(/đ/g, 'd');
}
