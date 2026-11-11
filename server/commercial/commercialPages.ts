import { firstReleaseLanguages } from '../../config/launchLanguages';
import { commercialCopy } from '../pilot-site/commercialCopy';
import { pilotLanguages } from '../pilot-site/languages';

const labels: Record<string, readonly [email: string, send: string, code: string, verify: string, invalid: string]> = {
  es: ['Correo electrónico', 'Enviar código', 'Código de ocho dígitos', 'Verificar y entrar', 'El código no es válido o ya venció.'],
  en: ['Email address', 'Send code', 'Eight-digit code', 'Verify and sign in', 'The code is invalid or has expired.'],
  pt: ['E-mail', 'Enviar código', 'Código de oito dígitos', 'Verificar e entrar', 'O código é inválido ou expirou.'],
  fr: ['Adresse e-mail', 'Envoyer le code', 'Code à huit chiffres', 'Vérifier et se connecter', 'Le code est invalide ou a expiré.'],
  de: ['E-Mail-Adresse', 'Code senden', 'Achtstelliger Code', 'Bestätigen und anmelden', 'Der Code ist ungültig oder abgelaufen.'],
  ja: ['メールアドレス', 'コードを送信', '8桁のコード', '確認してログイン', 'コードが無効か、期限が切れています。'],
  ko: ['이메일 주소', '코드 보내기', '8자리 코드', '확인하고 로그인', '코드가 잘못되었거나 만료되었습니다.'],
  ar: ['البريد الإلكتروني', 'أرسل الرمز', 'رمز من ثمانية أرقام', 'تحقّق وسجّل الدخول', 'الرمز غير صالح أو انتهت صلاحيته.'],
  cmn: ['电子邮箱', '发送验证码', '八位验证码', '验证并登录', '验证码无效或已过期。'],
  vi: ['Địa chỉ email', 'Gửi mã', 'Mã tám chữ số', 'Xác minh và đăng nhập', 'Mã không hợp lệ hoặc đã hết hạn.'],
};

const mailboxNotice: Record<string, string> = {
  es: 'Vista previa. Usa un correo ficticio. El código llega al buzón local de pruebas.',
  en: 'Preview. Use a test address. The code goes to the local test inbox.',
  pt: 'Prévia. Use um endereço de teste. O código chega à caixa de entrada local.',
  fr: 'Aperçu. Utilisez une adresse de test. Le code arrive dans la boîte de test locale.',
  de: 'Vorschau. Verwenden Sie eine Testadresse. Der Code kommt im lokalen Testpostfach an.',
  ja: 'プレビューです。テスト用のアドレスを使ってください。コードはローカルのテスト受信箱に届きます。',
  ko: '미리보기입니다. 테스트 주소를 사용하세요. 코드는 로컬 테스트 받은편지함으로 전송됩니다.',
  ar: 'معاينة. استخدم عنوان اختبار. يصل الرمز إلى صندوق الاختبار المحلي.',
  cmn: '预览。请使用测试地址。验证码会送达本地测试收件箱。',
  vi: 'Bản xem trước. Dùng địa chỉ thử nghiệm. Mã sẽ đến hộp thư thử nghiệm cục bộ.',
};

const accessCopy: Record<string, readonly [intro: string, codeIntro: string, changeEmail: string, existing: string, newAccount: string]> = {
  es: ['Usa tu correo para continuar. Te enviaremos un código de un solo uso.', 'Introduce el código para', 'Cambiar correo o pedir otro código', '¿Ya tienes cuenta?', '¿Aún no tienes cuenta?'],
  en: ['Enter your email to get a one-time code.', 'Enter the code for', 'Change email or request a new code', 'Already have an account?', 'New to LinguistVision?'],
  pt: ['Use seu e-mail para receber um código de uso único.', 'Digite o código para', 'Alterar o e-mail ou pedir outro código', 'Já tem uma conta?', 'Ainda não tem conta?'],
  fr: ['Saisissez votre adresse e-mail pour obtenir un code à usage unique.', 'Saisissez le code pour', 'Modifier l’adresse ou demander un nouveau code', 'Vous avez déjà un compte ?', 'Vous découvrez LinguistVision ?'],
  de: ['Geben Sie Ihre E-Mail-Adresse ein, um einen Einmalcode zu erhalten.', 'Geben Sie den Code ein für', 'E-Mail-Adresse ändern oder neuen Code anfordern', 'Sie haben bereits ein Konto?', 'Neu bei LinguistVision?'],
  ja: ['メールアドレスを入力してワンタイムコードを取得してください。', '次のメールアドレスのコードを入力してください。', 'メールアドレスを変更、または新しいコードを取得', 'アカウントをお持ちですか？', 'LinguistVisionは初めてですか？'],
  ko: ['이메일을 입력해 일회용 코드를 받으세요.', '다음 이메일의 코드를 입력하세요.', '이메일 변경 또는 새 코드 요청', '이미 계정이 있나요?', 'LinguistVision이 처음인가요?'],
  ar: ['أدخل بريدك الإلكتروني للحصول على رمز يُستخدم مرة واحدة.', 'أدخل الرمز الخاص بالبريد', 'غيّر البريد أو اطلب رمزًا جديدًا', 'هل لديك حساب بالفعل؟', 'هل أنت جديد على LinguistVision؟'],
  cmn: ['输入邮箱地址以获取一次性验证码。', '请输入此邮箱的验证码：', '更改邮箱或申请新验证码', '已有账号？', '第一次使用 LinguistVision？'],
  vi: ['Nhập email để nhận mã dùng một lần.', 'Nhập mã cho địa chỉ', 'Đổi email hoặc yêu cầu mã mới', 'Bạn đã có tài khoản?', 'Bạn mới dùng LinguistVision?'],
};

export const demoAssets = new Map([
  ['/demo/inter-400.ttf', ['inter-400.ttf', 'font/ttf']],
  ['/demo/inter-500.ttf', ['inter-500.ttf', 'font/ttf']],
  ['/demo/inter-600.ttf', ['inter-600.ttf', 'font/ttf']],
  ['/demo/inter-700.ttf', ['inter-700.ttf', 'font/ttf']],

  ['/demo/faq-ilustracion.jpg', ['faq-ilustracion.jpg', 'image/jpeg']],
  ['/demo/jobsite.mp4', ['jobsite.mp4', 'video/mp4']],
  ['/demo/jobsite.webp', ['jobsite.webp', 'image/webp']],
  ['/demo/jobsite.srt', ['jobsite.srt', 'application/x-subrip; charset=utf-8']],
  ['/demo/jobsite-draft.srt', ['jobsite-draft.srt', 'application/x-subrip; charset=utf-8']],
  ['/demo/jobsite.vtt', ['jobsite.vtt', 'text/vtt; charset=utf-8']],
] as const);

const escape = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function commercialLocale(id: string | null) {
  return firstReleaseLanguages.find(language => language.id === id) ?? firstReleaseLanguages[0];
}

export function renderCommercialPage(
  language: ReturnType<typeof commercialLocale>, page: 'demo' | 'register' | 'sign-in',
  email?: string, invalid = false,
) {
  const copy = commercialCopy[language.locale]!;
  const pack = pilotLanguages.find(candidate => candidate.locale === language.locale)!;
  const landing = '/' + pack.locale.toLowerCase() + '/' + pack.slug + '/';
  const title = copy[page === 'demo' ? 4 : page === 'register' ? 2 : 3];
  const query = '?lang=' + language.id;
  const head = '<!doctype html><html lang="' + language.locale + '" dir="' + language.direction +
    '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + escape(title) + ' | LinguistVision</title>';
  if (page === 'demo') {
    return head + '<link rel="stylesheet" href="/pilot/pilot.css"></head><body><main><header><a href="' + escape(landing) +
      '">LinguistVision</a><h1>' + escape(title) + '</h1></header><p>' + escape(copy[5]) +
      '</p><p><a href="/demo/jobsite.srt" download>' + escape(copy[6]) + '</a></p><div id="demo-editor" data-locale="' +
      language.id + '"></div><script type="module" src="/pilot/commercialDemo.js"></script></main></body></html>';
  }
  const [emailLabel, send, codeLabel, verify, error] = labels[language.id].map(escape);
  const [intro, codeIntro, changeEmail, existing, newAccount] = accessCopy[language.id].map(escape);
  const action = '/pilot/' + page + '/' + query;
  const register = page === 'register';
  const form = email === undefined
    ? '<label for="email">' + emailLabel + '</label><input id="email" name="email" dir="ltr" type="email"' +
      ' required maxlength="254" autocomplete="email" placeholder="you@example.com"><button>' + send + '</button>'
    : '<input type="hidden" name="email" value="' + escape(email) + '"><label for="code">' + codeLabel +
      '</label><input id="code" name="code" dir="ltr" inputmode="numeric" pattern="[0-9]{8}" maxlength="8"' +
      ' required autocomplete="one-time-code"' + (invalid ? ' aria-invalid="true" aria-describedby="code-error"' : '') + '>' +
      (invalid ? '<p id="code-error" class="error" role="alert">' + error + '</p>' : '') + '<button>' + verify + '</button>';
  const next = email !== undefined ? '<a href="' + action + '">' + changeEmail + '</a>' :
    (register ? existing : newAccount) + ' <a href="/pilot/' + (register ? 'sign-in' : 'register') + '/' + query + '">' +
    escape(copy[register ? 3 : 2]) + '</a>';
  return head + '<link rel="stylesheet" href="/pilot/account.css"></head><body><main><section aria-labelledby="account-title">' +
    '<header><a class="brand" href="' + escape(landing) + '"><span aria-hidden="true">LV</span><bdi>LinguistVision</bdi></a>' +
    '<h1 id="account-title">' + escape(title) + '</h1><p>' + (email === undefined ? intro : codeIntro + ' <bdi dir="ltr">' +
      escape(email) + '</bdi>') + '</p></header><form method="post" action="' + action + '">' + form + '</form>' +
    '<p class="next">' + next + '</p></section><p class="preview-note">' + escape(mailboxNotice[language.id]) + '</p></main></body></html>';
}
