import { commercialCopy } from '../pilot-site/commercialCopy';
import { pilotLanguages } from '../pilot-site/languages';
import type { commercialLocale } from './commercialPages';

export type AccessPage = 'register' | 'sign-in' | 'forgot' | 'reset';
type Language = ReturnType<typeof commercialLocale>;
type Copy = readonly [email: string, password: string, google: string, forgot: string, send: string, reset: string,
  checkEmail: string, invalid: string, updated: string];

const googleActions: Record<string, readonly [signIn: string, signUp: string]> = {
  en: ['Sign in with Google', 'Sign up with Google'],
  es: ['Iniciar sesión con Google', 'Registrarse con Google'],
  pt: ['Entrar com o Google', 'Cadastrar-se com o Google'],
  fr: ['Se connecter avec Google', 'S’inscrire avec Google'],
  de: ['Mit Google anmelden', 'Mit Google registrieren'],
  ja: ['Googleでログイン', 'Googleで登録'],
  ko: ['Google 계정으로 로그인', 'Google 계정으로 가입'],
  ar: ['تسجيل الدخول باستخدام Google', 'التسجيل باستخدام Google'],
  cmn: ['使用 Google 登录', '使用 Google 注册'],
  vi: ['Đăng nhập bằng Google', 'Đăng ký bằng Google'],
};

// Official Google HTML button artwork, supplied by the owner. Decorative to avoid a duplicate accessible name.
const googleIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  <path fill="none" d="M0 0h48v48H0z"/>
</svg>`;

const copy: Record<string, Copy> = {
  en: ['Email', 'Password', 'Continue with Google', 'Forgot password?', 'Send recovery link', 'Save new password', 'If the request is eligible, check your email. Open the link in this browser.', 'We couldn’t complete your request. Check your details or start again.', 'Password updated. Sign in with your new password.'],
  es: ['Correo electrónico', 'Contraseña', 'Continuar con Google', '¿Olvidaste tu contraseña?', 'Enviar enlace de recuperación', 'Guardar nueva contraseña', 'Si la solicitud es válida, revisa tu correo. Abre el enlace en este navegador.', 'No pudimos completar la solicitud. Revisa tus datos o vuelve a empezar.', 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.'],
  ar: ['البريد الإلكتروني', 'كلمة المرور', 'المتابعة باستخدام Google', 'هل نسيت كلمة المرور؟', 'أرسل رابط الاسترداد', 'احفظ كلمة المرور الجديدة', 'تحقق من بريدك إذا كان الطلب صالحًا. افتح الرابط في هذا المتصفح.', 'تعذر إكمال الطلب. تحقق من بياناتك أو حاول من جديد.', 'تم تحديث كلمة المرور. سجّل الدخول بكلمة المرور الجديدة.'],
  pt: ['E-mail', 'Senha', 'Continuar com o Google', 'Esqueceu a senha?', 'Enviar link de recuperação', 'Salvar nova senha', 'Se o pedido for válido, confira seu e-mail. Abra o link neste navegador.', 'Não foi possível concluir. Confira os dados ou tente novamente.', 'Senha atualizada. Entre com sua nova senha.'],
  fr: ['Adresse e-mail', 'Mot de passe', 'Continuer avec Google', 'Mot de passe oublié ?', 'Envoyer le lien de récupération', 'Enregistrer le nouveau mot de passe', 'Si la demande est valide, consultez vos e-mails. Ouvrez le lien dans ce navigateur.', 'La demande a échoué. Vérifiez vos informations ou recommencez.', 'Mot de passe mis à jour. Connectez-vous avec votre nouveau mot de passe.'],
  de: ['E-Mail-Adresse', 'Passwort', 'Mit Google fortfahren', 'Passwort vergessen?', 'Link zur Wiederherstellung senden', 'Neues Passwort speichern', 'Prüfen Sie bei einer gültigen Anfrage Ihr Postfach. Öffnen Sie den Link in diesem Browser.', 'Die Anfrage konnte nicht abgeschlossen werden. Prüfen Sie Ihre Angaben oder beginnen Sie erneut.', 'Passwort aktualisiert. Melden Sie sich mit dem neuen Passwort an.'],
  ja: ['メールアドレス', 'パスワード', 'Googleで続行', 'パスワードをお忘れですか？', '再設定リンクを送信', '新しいパスワードを保存', 'リクエストが有効な場合はメールをご確認ください。このブラウザでリンクを開いてください。', 'リクエストを完了できませんでした。入力内容をご確認のうえ、もう一度お試しください。', 'パスワードを更新しました。新しいパスワードでログインしてください。'],
  ko: ['이메일 주소', '비밀번호', 'Google로 계속', '비밀번호를 잊으셨나요?', '복구 링크 보내기', '새 비밀번호 저장', '유효한 요청이면 이메일을 확인하고 이 브라우저에서 링크를 여세요.', '요청을 완료하지 못했습니다. 입력 내용을 확인하거나 다시 시작하세요.', '비밀번호를 변경했습니다. 새 비밀번호로 로그인하세요.'],
  cmn: ['邮箱地址', '密码', '使用 Google 继续', '忘记密码？', '发送恢复链接', '保存新密码', '如果请求有效，请查收邮件，并在此浏览器中打开链接。', '无法完成请求。请检查输入内容或重试。', '密码已更新。请使用新密码登录。'],
  vi: ['Địa chỉ email', 'Mật khẩu', 'Tiếp tục với Google', 'Quên mật khẩu?', 'Gửi liên kết khôi phục', 'Lưu mật khẩu mới', 'Nếu yêu cầu hợp lệ, hãy kiểm tra email và mở liên kết trong trình duyệt này.', 'Không thể hoàn tất yêu cầu. Hãy kiểm tra thông tin hoặc thử lại.', 'Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.'],
};

type PresentationCopy = readonly [divider: string, show: string, hide: string, hint: string, existing: string,
  newAccount: string, recoveryTitle: string, recoveryIntro: string];
const presentation: Record<string, PresentationCopy> = {
  en: ['or use your email', 'Show', 'Hide', 'At least 8 characters.', 'Already have an account?', 'New to Vistavo?', 'Recover your password', 'Enter your account email. If the request is eligible, you will receive a link to create a new password.'],
  es: ['o con tu correo', 'Mostrar', 'Ocultar', 'Mínimo 8 caracteres.', '¿Ya tienes cuenta?', '¿No tienes cuenta?', 'Recuperar contraseña', 'Escribe el correo de tu cuenta. Si la solicitud es válida, recibirás un enlace para crear una contraseña nueva.'],
  pt: ['ou use seu e-mail', 'Mostrar', 'Ocultar', 'Pelo menos 8 caracteres.', 'Já tem uma conta?', 'Ainda não tem conta?', 'Recuperar senha', 'Digite o e-mail da sua conta. Se o pedido for válido, você receberá um link para criar uma nova senha.'],
  fr: ['ou avec votre e-mail', 'Afficher', 'Masquer', 'Au moins 8 caractères.', 'Vous avez déjà un compte ?', 'Vous n’avez pas de compte ?', 'Récupérer le mot de passe', 'Saisissez l’adresse e-mail de votre compte. Si la demande est valide, vous recevrez un lien pour créer un nouveau mot de passe.'],
  de: ['oder mit Ihrer E-Mail-Adresse', 'Anzeigen', 'Verbergen', 'Mindestens 8 Zeichen.', 'Sie haben bereits ein Konto?', 'Sie haben noch kein Konto?', 'Passwort wiederherstellen', 'Geben Sie die E-Mail-Adresse Ihres Kontos ein. Bei einer gültigen Anfrage erhalten Sie einen Link, um ein neues Passwort zu erstellen.'],
  ja: ['またはメールアドレスで続行', '表示', '非表示', '8文字以上。', 'アカウントをお持ちですか？', 'アカウントをお持ちでない方', 'パスワードの再設定', 'アカウントのメールアドレスを入力してください。リクエストが有効な場合、新しいパスワードを作成するためのリンクが届きます。'],
  ko: ['또는 이메일로 계속', '표시', '숨기기', '8자 이상 입력하세요.', '이미 계정이 있나요?', '계정이 없나요?', '비밀번호 복구', '계정 이메일을 입력하세요. 유효한 요청이면 새 비밀번호를 만드는 링크가 전송됩니다.'],
  ar: ['أو باستخدام بريدك الإلكتروني', 'إظهار', 'إخفاء', '٨ أحرف على الأقل.', 'هل لديك حساب بالفعل؟', 'ليس لديك حساب؟', 'استرداد كلمة المرور', 'أدخل بريد حسابك الإلكتروني. إذا كان الطلب صالحًا، فستتلقى رابطًا لإنشاء كلمة مرور جديدة.'],
  cmn: ['或使用邮箱', '显示', '隐藏', '至少8个字符。', '已有账号？', '还没有账号？', '找回密码', '输入账号的邮箱地址。如果请求有效，你将收到创建新密码的链接。'],
  vi: ['hoặc dùng email', 'Hiện', 'Ẩn', 'Ít nhất 8 ký tự.', 'Bạn đã có tài khoản?', 'Bạn chưa có tài khoản?', 'Khôi phục mật khẩu', 'Nhập email của tài khoản. Nếu yêu cầu hợp lệ, bạn sẽ nhận được liên kết để tạo mật khẩu mới.'],
};

export function renderAccountAccess(language: Language, page: AccessPage, notice?: 'sent' | 'error' | 'updated', firebase = false) {
  const [email, password, , forgot, send, reset, sent, error, updated] = copy[language.id];
  const google = googleActions[language.id][page === 'register' ? 1 : 0];
  const [divider, show, hide, hint, existing, newAccount, recoveryTitle, recoveryIntro] = presentation[language.id];
  const [, , register, login] = commercialCopy[language.locale]!;
  const pack = pilotLanguages.find(item => item.locale === language.locale)!;
  const landing = '/' + pack.locale.toLowerCase() + '/' + encodeURIComponent(pack.slug) + '/';
  const query = '?lang=' + language.id;
  const title = { register, 'sign-in': login, forgot: recoveryTitle, reset }[page];
  const standard = page === 'register' || page === 'sign-in';
  const action = '/pilot/' + (standard ? page : 'auth/' + page) + '/' + query;
  const message = notice ? '<p class="auth-status' + (notice === 'error' ? ' error" role="alert' : '" role="status') + '">' +
    { sent, error, updated }[notice] + '</p>' : '';
  return `<!doctype html><html lang="${language.locale}" dir="${language.direction}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
    <title>${title} | Vistavo</title><link rel="stylesheet" href="/pilot/account.css">
    <script type="module" src="/pilot/editor-assets/accountUi.js"></script>
    ${firebase ? '<script type="module" src="/pilot/editor-assets/firebaseAuth.js"></script>' : ''}</head><body data-auth-page="${page}">
    <header class="auth-header"><a class="brand" href="${landing}"><bdi>Vistavo</bdi></a></header>
    <main class="auth-main"><section class="auth-panel" aria-labelledby="account-title"><h1 id="account-title">${title}</h1>
    ${page === 'forgot' ? '<p class="auth-intro">' + recoveryIntro + '</p>' : ''}${message}
    ${firebase ? '<p id="auth-message" role="status" class="auth-status" aria-live="polite"></p>' : ''}
    ${standard ? `<form id="auth-google" method="post" action="/pilot/auth/google/${query}"><button type="submit" class="gsi-material-button">
    <span class="gsi-material-button-state" aria-hidden="true"></span><span class="gsi-material-button-content-wrapper">
    <span class="gsi-material-button-icon">${googleIcon}</span><span class="gsi-material-button-contents">${google}</span></span></button></form>
    <p class="auth-divider">${divider}</p>` : ''}
    <form id="auth-form" method="post" action="${action}">
    ${page !== 'reset' ? `<label for="email">${email}</label><input id="email" name="email" dir="ltr" type="email" required maxlength="254" autocomplete="email">` : ''}
    ${page !== 'forgot' ? `<div class="auth-label-row"><label for="password">${password}</label>
    ${page === 'sign-in' ? `<a class="forgot" href="/pilot/auth/forgot/${query}">${forgot}</a>` : ''}</div>
    <div class="auth-password"><input id="password" name="password" dir="ltr" type="password"
    required maxlength="128" ${page !== 'sign-in' ? 'minlength="8" aria-describedby="password-help"' : ''} autocomplete="${page === 'sign-in' ? 'current-password' : 'new-password'}">
    <button id="auth-password-toggle" class="auth-secondary" type="button" aria-controls="password" aria-pressed="false"
    data-show="${show}" data-hide="${hide}" hidden>${show}</button></div>
    ${page !== 'sign-in' ? '<p class="auth-hint" id="password-help">' + hint + '</p>' : ''}` : ''}
    <button>${page === 'forgot' ? send : title}</button></form>
    <p class="next">${standard ? (page === 'sign-in' ? newAccount : existing) + ' ' : ''}<a href="/pilot/${page === 'sign-in' ? 'register' : 'sign-in'}/${query}">${page === 'sign-in' ? register : login}</a></p>
    ${firebase ? '<div id="auth-verification" hidden><button id="auth-resend" type="button" class="auth-secondary"></button><button id="auth-check" type="button"></button><button id="auth-signout" type="button" class="auth-secondary"></button></div>' : ''}
    </section></main></body></html>`;
}
