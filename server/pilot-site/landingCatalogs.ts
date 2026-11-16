import en from './landing-locales/en-US';
import pt from './landing-locales/pt-BR';
import fr from './landing-locales/fr';
import de from './landing-locales/de';
import ja from './landing-locales/ja';
import ko from './landing-locales/ko';
import ar from './landing-locales/ar';
import zh from './landing-locales/zh-Hans';
import vi from './landing-locales/vi';
import { validateLandingCopy, type LandingLocaleCopy } from './localizedLanding';

export const landingCatalogs: Readonly<Record<string, LandingLocaleCopy>> = Object.freeze(Object.fromEntries(
  [en, pt, fr, de, ja, ko, ar, zh, vi].map(copy => {
    validateLandingCopy(copy);
    return [copy.locale, copy];
  }),
));
