import { firstReleaseLanguages } from '../../../config/launchLanguages';

export type PublicAuthPage = 'sign-in' | 'register' | 'forgot' | 'account';
export const publicAuthOrigin = 'https://vistavo.app';
export const publicAuthPreviewOrigin = 'http://127.0.0.1:3001';
const routes: Record<PublicAuthPage, string> = { 'sign-in': 'acceso', register: 'registro', forgot: 'recuperar', account: 'cuenta' };

export function publicAuthLanguage(locale: string) {
  const language = firstReleaseLanguages.find(item => item.locale.toLowerCase() === locale);
  if (!language) throw new Error('unsupported_locale');
  return language;
}

export function publicAuthPath(locale: string, page: PublicAuthPage): string {
  const language = publicAuthLanguage(locale);
  if (!Object.hasOwn(routes, page)) throw new Error('unsupported_page');
  return '/' + routes[page] + '/' + language.locale.toLowerCase() + '/';
}

export function publicAuthLocation(pathname: string) {
  const match = /^\/(acceso|registro|recuperar|cuenta)\/([a-z0-9-]+)\/$/.exec(pathname);
  if (!match) throw new Error('unsupported_route');
  const page = (Object.keys(routes) as PublicAuthPage[]).find(key => routes[key] === match[1])!;
  return { page, locale: match[2], language: publicAuthLanguage(match[2]) };
}

export function requirePublicAuthOrigin(origin: string): void {
  if (origin !== publicAuthOrigin && origin !== publicAuthPreviewOrigin) throw new Error('unsupported_origin');
}

export function publicEmailReturnUrl(locale: string): string {
  return publicAuthOrigin + publicAuthPath(locale, 'sign-in');
}

export function validatePublicAuthConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_auth_config');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => /emulator/i.test(key))) throw new Error('emulator_forbidden');
  for (const field of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (!Object.hasOwn(record, field) || typeof record[field] !== 'string') throw new Error('invalid_auth_config');
  }
  if (record.projectId !== 'vistavo-prod' || record.appId !== '1:107404655346:web:15c4589a314cf3e4d9ae6b' ||
      record.authDomain !== 'vistavo-prod.firebaseapp.com' || !/^AIza[A-Za-z0-9_-]{35}$/.test(record.apiKey as string)) {
    throw new Error('wrong_auth_project');
  }
  // Hosting may include optional public service fields. Never spread them into SDK config.
  return { apiKey: record.apiKey as string, authDomain: record.authDomain as string,
    projectId: record.projectId as string, appId: record.appId as string };
}

export function createPublicAuthFence() {
  let revision = 0;
  let locallySignedOut = false;
  return {
    beginSignIn() { locallySignedOut = false; return ++revision; },
    beginSignOut() { locallySignedOut = true; return ++revision; },
    beginPublicAction() { return ++revision; },
    current: () => revision,
    matchesAction: (ticket: number) => ticket === revision,
    isCurrent: (ticket: number) => ticket === revision && !locallySignedOut,
    permitsUser: () => !locallySignedOut,
  };
}

/** Hide synchronously; drain an older auth action before a possible final SDK cleanup. */
export async function finishPublicSignOut(ops: {
  hideImmediately: () => void;
  signOut: () => Promise<unknown>;
  pending: Promise<unknown> | null;
  hasUser: () => boolean;
  failed: () => void;
}): Promise<boolean> {
  ops.hideImmediately();
  let success = true;
  try { await ops.signOut(); } catch { success = false; ops.failed(); }
  try { await ops.pending; } catch { /* An earlier sign-in error is not a sign-out acknowledgement. */ }
  if (ops.hasUser()) {
    try { await ops.signOut(); } catch { success = false; ops.failed(); }
  }
  return success;
}

const labelKeys = ['account', 'name', 'email', 'status', 'verified', 'unverified', 'noName', 'guest', 'signIn', 'register', 'home',
  'loading', 'initFailed', 'popupBlocked', 'createdEmailFailed', 'logoutFailed', 'existingMethod', 'js'] as const;
export type PublicAuthLabels = Record<typeof labelKeys[number], string>;
const copy: Record<string, readonly string[]> = {
  es: ['Mi cuenta', 'Nombre', 'Correo electrónico', 'Verificación', 'Correo verificado', 'Correo sin verificar', 'No indicado', 'Inicia sesión para consultar tu cuenta.', 'Iniciar sesión', 'Crear cuenta', 'Volver a Vistavo', 'Preparando el acceso…', 'No se pudo iniciar el acceso. Recarga la página en tu navegador habitual.', 'Permite la ventana emergente de Google y pulsa el botón de nuevo.', 'Tu cuenta se creó, pero no pudimos enviar la verificación. Puedes volver a enviarla.', 'No pudimos cerrar completamente la sesión. Tus datos se han ocultado; vuelve a intentar salir.', 'Usa el método con el que ya tienes cuenta. No vinculamos cuentas automáticamente.', 'Activa JavaScript para iniciar sesión.'],
  en: ['My account', 'Name', 'Email', 'Verification', 'Email verified', 'Email not verified', 'Not provided', 'Sign in to view your account.', 'Sign in', 'Create account', 'Back to Vistavo', 'Preparing sign-in…', 'Sign-in could not start. Reload this page in your usual browser.', 'Allow the Google popup and press the button again.', 'Your account was created, but we could not send verification. You can send it again.', 'We could not fully sign you out. Your details are hidden; try signing out again.', 'Use your existing sign-in method. Accounts are not linked automatically.', 'Enable JavaScript to sign in.'],
  pt: ['Minha conta', 'Nome', 'E-mail', 'Verificação', 'E-mail verificado', 'E-mail não verificado', 'Não informado', 'Entre para consultar sua conta.', 'Entrar', 'Criar conta', 'Voltar ao Vistavo', 'Preparando o acesso…', 'Não foi possível iniciar o acesso. Recarregue no navegador habitual.', 'Permita a janela do Google e pressione o botão novamente.', 'Sua conta foi criada, mas não enviamos a verificação. Você pode reenviá-la.', 'Não foi possível encerrar a sessão completamente. Seus dados estão ocultos; tente sair novamente.', 'Use o método de acesso existente. As contas não são vinculadas automaticamente.', 'Ative o JavaScript para entrar.'],
  fr: ['Mon compte', 'Nom', 'E-mail', 'Vérification', 'E-mail vérifié', 'E-mail non vérifié', 'Non indiqué', 'Connectez-vous pour consulter votre compte.', 'Se connecter', 'Créer un compte', 'Retour à Vistavo', 'Préparation de la connexion…', 'La connexion ne peut pas démarrer. Rechargez dans votre navigateur habituel.', 'Autorisez la fenêtre Google et cliquez à nouveau.', 'Votre compte est créé, mais l’e-mail de vérification n’a pas été envoyé. Vous pouvez le renvoyer.', 'La déconnexion n’a pas pu être terminée. Vos données sont masquées ; réessayez.', 'Utilisez votre méthode de connexion actuelle. Les comptes ne sont pas associés automatiquement.', 'Activez JavaScript pour vous connecter.'],
  de: ['Mein Konto', 'Name', 'E-Mail', 'Bestätigung', 'E-Mail bestätigt', 'E-Mail nicht bestätigt', 'Nicht angegeben', 'Melden Sie sich an, um Ihr Konto anzusehen.', 'Anmelden', 'Konto erstellen', 'Zurück zu Vistavo', 'Anmeldung wird vorbereitet…', 'Die Anmeldung konnte nicht starten. Laden Sie die Seite im üblichen Browser neu.', 'Erlauben Sie das Google-Popup und klicken Sie erneut.', 'Ihr Konto wurde erstellt, die Bestätigung konnte jedoch nicht gesendet werden. Sie können sie erneut senden.', 'Die Abmeldung konnte nicht vollständig abgeschlossen werden. Ihre Daten sind ausgeblendet; versuchen Sie es erneut.', 'Nutzen Sie Ihre bisherige Anmeldemethode. Konten werden nicht automatisch verknüpft.', 'Aktivieren Sie JavaScript für die Anmeldung.'],
  ja: ['マイアカウント', '名前', 'メールアドレス', '確認状況', 'メール確認済み', 'メール未確認', '未登録', 'アカウントを表示するにはログインしてください。', 'ログイン', 'アカウント作成', 'Vistavoに戻る', 'ログインを準備中…', 'ログインを開始できません。通常のブラウザで再読み込みしてください。', 'Googleのポップアップを許可して、もう一度ボタンを押してください。', 'アカウントは作成されましたが、確認メールを送信できませんでした。再送信できます。', 'ログアウトを完了できませんでした。情報は非表示です。もう一度ログアウトしてください。', '既存のログイン方法を使用してください。アカウントは自動連携されません。', 'ログインにはJavaScriptを有効にしてください。'],
  ko: ['내 계정', '이름', '이메일', '인증 상태', '이메일 인증됨', '이메일 미인증', '제공되지 않음', '계정을 보려면 로그인하세요.', '로그인', '계정 만들기', 'Vistavo로 돌아가기', '로그인 준비 중…', '로그인을 시작하지 못했습니다. 평소 사용하는 브라우저에서 새로고침하세요.', 'Google 팝업을 허용한 후 버튼을 다시 누르세요.', '계정은 생성되었지만 인증 이메일을 보내지 못했습니다. 다시 보낼 수 있습니다.', '로그아웃을 완료하지 못했습니다. 정보는 숨겨졌습니다. 다시 로그아웃하세요.', '기존 로그인 방법을 사용하세요. 계정은 자동으로 연결되지 않습니다.', '로그인하려면 JavaScript를 활성화하세요.'],
  ar: ['حسابي', 'الاسم', 'البريد الإلكتروني', 'التحقق', 'البريد مؤكد', 'البريد غير مؤكد', 'غير محدد', 'سجّل الدخول لعرض حسابك.', 'تسجيل الدخول', 'إنشاء حساب', 'العودة إلى Vistavo', 'جارٍ إعداد تسجيل الدخول…', 'تعذر بدء تسجيل الدخول. أعد تحميل الصفحة في متصفحك المعتاد.', 'اسمح بنافذة Google المنبثقة ثم اضغط الزر مجددًا.', 'تم إنشاء حسابك، لكن تعذر إرسال رسالة التحقق. يمكنك إعادة إرسالها.', 'تعذر إنهاء الجلسة بالكامل. تم إخفاء بياناتك؛ حاول تسجيل الخروج مجددًا.', 'استخدم طريقة دخولك الحالية. لا يتم ربط الحسابات تلقائيًا.', 'فعّل JavaScript لتسجيل الدخول.'],
  cmn: ['我的账号', '姓名', '邮箱', '验证状态', '邮箱已验证', '邮箱未验证', '未提供', '请登录以查看账号。', '登录', '创建账号', '返回 Vistavo', '正在准备登录…', '无法启动登录。请在常用浏览器中刷新页面。', '请允许 Google 弹出窗口，然后再次点击按钮。', '账号已创建，但验证邮件未能发送。你可以重新发送。', '未能完全退出登录。你的信息已隐藏，请再次尝试退出。', '请使用现有登录方式。账号不会自动关联。', '请启用 JavaScript 以登录。'],
  vi: ['Tài khoản của tôi', 'Tên', 'Email', 'Xác minh', 'Email đã xác minh', 'Email chưa xác minh', 'Chưa cung cấp', 'Đăng nhập để xem tài khoản.', 'Đăng nhập', 'Tạo tài khoản', 'Quay lại Vistavo', 'Đang chuẩn bị đăng nhập…', 'Không thể bắt đầu đăng nhập. Hãy tải lại bằng trình duyệt thường dùng.', 'Cho phép cửa sổ Google rồi nhấn nút lần nữa.', 'Tài khoản đã được tạo nhưng chưa gửi được email xác minh. Bạn có thể gửi lại.', 'Chưa thể đăng xuất hoàn toàn. Thông tin đã ẩn; hãy thử đăng xuất lại.', 'Dùng phương thức đăng nhập hiện có. Tài khoản không tự động liên kết.', 'Bật JavaScript để đăng nhập.'],
};

export function publicAuthLabels(id: string): PublicAuthLabels {
  const values = copy[id];
  if (!values || values.length !== labelKeys.length) throw new Error('missing_auth_copy');
  return Object.fromEntries(labelKeys.map((key, index) => [key, values[index]])) as PublicAuthLabels;
}
