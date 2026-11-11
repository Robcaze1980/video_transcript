const escape = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export const marketingIcon = (name: string) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ({
  inspection: '<path d="m3 11 9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',
  repair: '<path d="M15 4a5 5 0 0 0-6 7L3 17l4 4 6-6a5 5 0 0 0 7-6l-4 4-4-4z"/>',
  training: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="m8 21 4-5 4 5"/>',
  srt: '<path d="M14 3H6v18h12V7zM14 3v4h4M9 12h6M9 16h4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16zM13 7l4 4"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M5 20h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 5 5L20 5"/>',
}[name] ?? '<circle cx="12" cy="12" r="8"/>') + '</svg>';

export const commercialTopCopy: Record<string, readonly string[]> = {
 'es-419': ['Cómo funciona','Idiomas','Precios','Preguntas','Idioma del sitio','Desde US$1 por 10 minutos de video · Piloto: videos de hasta 30 segundos'],
 'en-US': ['How it works','Languages','Pricing','Questions','Site language','From US$1 for 10 video minutes · Pilot: videos up to 30 seconds'],
 'pt-BR': ['Como funciona','Idiomas','Preços','Perguntas','Idioma do site','A partir de US$1 por 10 minutos de vídeo · Piloto: vídeos de até 30 segundos'],
 fr: ['Comment ça marche','Langues','Tarifs','Questions','Langue du site','Dès 1 USD pour 10 minutes de vidéo · Pilote : vidéos de 30 secondes maximum'],
 de: ['So funktioniert’s','Sprachen','Preise','Fragen','Sprache der Website','Ab 1 US$ für 10 Videominuten · Pilot: Videos bis 30 Sekunden'],
 ar: ['كيف يعمل','اللغات','الأسعار','الأسئلة','لغة الموقع','من دولار أمريكي مقابل 10 دقائق فيديو · التجربة: فيديو حتى 30 ثانية'],
 ja: ['使い方','言語','料金','質問','サイトの言語','動画10分あたり1米ドルから · パイロット：動画は最大30秒'],
 ko: ['이용 방법','언어','요금','질문','사이트 언어','동영상 10분에 US$1부터 · 파일럿: 최대 30초 동영상'],
 'zh-Hans': ['使用方法','语言','价格','问题','网站语言','10分钟视频1美元起 · 试用：视频最长30秒'],
 vi: ['Cách hoạt động','Ngôn ngữ','Giá','Câu hỏi','Ngôn ngữ trang web','Từ 1 USD cho 10 phút video · Thử nghiệm: video tối đa 30 giây'],
};
const startIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
const priceIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>';

// All phrases are invented editorial examples. None represents a processing result or pair activation.
const keys = ['title','intro','start','prices','tabs','input','review','result','original','translation','correcting','corrected','illustrative','pause','play','source','output','timing','sameVoice','imported','inspection','repair','training','subtitle'] as const;
const strings: Record<string, string[]> = {
  'es-419': ['Tu video, con subtítulos que tu cliente entiende.','Conserva tu voz. Traduce los subtítulos, revisa cada frase y descarga el resultado.','Comenzar','Ver precios','Ejemplos de uso','Video','Revisar subtítulos','Resultado','Frase original','Traducción','Revisando la frase','Corrección del usuario','Ejemplos ilustrativos con frases inventadas. No son capturas ni resultados procesados. Consulta la disponibilidad antes de elegir un destino.','Pausar el cambio automático','Reanudar el cambio automático','Idioma del ejemplo','Archivo de ejemplo','Ajustar el inicio de la frase','La voz original se conserva. Tú descargas y envías el archivo.','Video y SRT existentes: sin volver a transcribir.','Inspección','Reparación','Capacitación','Editar un SRT'],
  'en-US': ['Your video, with subtitles your customer understands.','Keep your voice. Translate the subtitles, review each line, and download the result.','Get started','View pricing','Use case examples','Video','Review subtitles','Result','Original line','Translation','Reviewing the line','User correction','Illustrative examples with invented lines, not screenshots or processed results. Check availability before choosing a destination.','Pause automatic switching','Resume automatic switching','Example language','Example file','Adjust the line start','Your original voice stays. You download and send the file.','Existing video and SRT: no retranscription.','Inspection','Repair','Training','Edit an SRT'],
  'pt-BR': ['Seu vídeo, com legendas que seu cliente entende.','Mantenha sua voz. Traduza as legendas, revise cada frase e baixe o resultado.','Começar','Ver preços','Exemplos de uso','Vídeo','Revisar legendas','Resultado','Frase original','Tradução','Revisando a frase','Correção do usuário','Exemplos ilustrativos com frases inventadas. Não são capturas nem resultados processados. Consulte a disponibilidade antes de escolher um destino.','Pausar troca automática','Retomar troca automática','Idioma do exemplo','Arquivo de exemplo','Ajustar o início da frase','Sua voz original permanece. Você baixa e envia o arquivo.','Vídeo e SRT existentes: sem transcrever novamente.','Inspeção','Reparo','Treinamento','Editar um SRT'],
  fr: ['Votre vidéo, avec des sous-titres que votre client comprend.','Gardez votre voix. Traduisez les sous-titres, vérifiez chaque phrase et téléchargez le résultat.','Commencer','Voir les prix','Exemples d’utilisation','Vidéo','Vérifier les sous-titres','Résultat','Phrase originale','Traduction','Vérification de la phrase','Correction par l’utilisateur','Exemples illustratifs avec des phrases inventées, sans captures ni résultats traités. Vérifiez la disponibilité du sens de traduction.','Suspendre le défilement automatique','Reprendre le défilement automatique','Langue de l’exemple','Fichier d’exemple','Ajuster le début de la phrase','La voix originale reste. Vous téléchargez et envoyez le fichier.','Vidéo et SRT existants : sans retranscription.','Inspection','Réparation','Formation','Modifier un SRT'],
  de: ['Ihr Video mit Untertiteln, die Ihr Kunde versteht.','Behalten Sie Ihre Stimme. Übersetzen und prüfen Sie die Untertitel vor dem Download.','Starten','Preise ansehen','Anwendungsbeispiele','Video','Untertitel prüfen','Ergebnis','Originalsatz','Übersetzung','Satz wird geprüft','Korrektur durch den Nutzer','Illustrative Beispiele mit erfundenen Sätzen, keine Aufnahmen oder Verarbeitungsergebnisse. Prüfen Sie die verfügbare Übersetzungsrichtung.','Automatischen Wechsel pausieren','Automatischen Wechsel fortsetzen','Beispielsprache','Beispieldatei','Satzanfang anpassen','Die Originalstimme bleibt. Sie laden die Datei herunter und versenden sie selbst.','Vorhandenes Video und SRT: ohne erneute Transkription.','Inspektion','Reparatur','Schulung','SRT bearbeiten'],
  ar: ['فيديوك، بترجمة مكتوبة يفهمها عميلك.','احتفظ بصوتك. ترجم النص، وراجع كل عبارة، ثم نزّل النتيجة.','ابدأ','عرض الأسعار','أمثلة الاستخدام','فيديو','مراجعة الترجمة','النتيجة','العبارة الأصلية','الترجمة','مراجعة العبارة','تصحيح المستخدم','أمثلة توضيحية بعبارات مختلقة، وليست لقطات أو نتائج معالجة. تحقّق من توفر اتجاه الترجمة أولًا.','إيقاف التبديل التلقائي','استئناف التبديل التلقائي','لغة المثال','ملف المثال','ضبط بداية العبارة','يبقى الصوت الأصلي. أنت تنزّل الملف وترسله.','فيديو وملف SRT موجودان: دون إعادة التفريغ.','فحص','إصلاح','تدريب','تعديل SRT'],
  ja: ['お客様に伝わる字幕を、あなたの動画に。','元の声はそのまま。字幕を翻訳し、一文ずつ確認してダウンロード。','始める','料金を見る','利用例','動画','字幕を確認','結果','元の文','翻訳','文を確認中','利用者による修正','架空の文を使った説明用の例です。実際の画面や処理結果ではありません。翻訳方向の提供状況をご確認ください。','自動切り替えを一時停止','自動切り替えを再開','例の言語','サンプルファイル','字幕の開始を調整','元の音声を保持します。利用者がファイルをダウンロードして送信します。','既存の動画とSRT：再文字起こし不要。','点検','修理','研修','SRTを編集'],
  ko: ['고객이 이해하는 자막을 동영상에 담으세요.','원래 목소리를 유지하세요. 자막을 번역하고 문장별로 검토한 뒤 다운로드하세요.','시작하기','요금 보기','사용 예시','동영상','자막 검토','결과','원문','번역','문장 검토 중','사용자 수정','가상의 문장을 사용한 예시입니다. 실제 화면이나 처리 결과가 아닙니다. 번역 방향의 제공 여부를 확인하세요.','자동 전환 일시 중지','자동 전환 재개','예시 언어','예시 파일','자막 시작 조정','원래 음성을 유지합니다. 사용자가 파일을 다운로드하고 전송합니다.','기존 동영상과 SRT: 다시 받아쓰지 않습니다.','점검','수리','교육','SRT 편집'],
  'zh-Hans': ['让客户看懂您视频中的字幕。','保留原声。翻译字幕，逐句检查，再下载结果。','开始使用','查看价格','使用示例','视频','检查字幕','结果','原文','译文','正在检查句子','用户修改','以下使用虚构句子演示，并非实际截图或处理结果。请先查看翻译方向是否可用。','暂停自动切换','恢复自动切换','示例语言','示例文件','调整字幕开始时间','保留原声。由您下载并发送文件。','已有视频和SRT：无需重新转录。','检查','维修','培训','编辑SRT'],
  vi: ['Video của bạn, với phụ đề khách hàng có thể hiểu.','Giữ nguyên giọng nói. Dịch phụ đề, xem lại từng câu và tải kết quả.','Bắt đầu','Xem giá','Ví dụ sử dụng','Video','Xem lại phụ đề','Kết quả','Câu gốc','Bản dịch','Đang xem lại câu','Người dùng chỉnh sửa','Ví dụ minh họa với câu hư cấu, không phải ảnh chụp hay kết quả xử lý. Kiểm tra hướng dịch được hỗ trợ trước.','Tạm dừng chuyển tự động','Tiếp tục chuyển tự động','Ngôn ngữ ví dụ','Tệp ví dụ','Điều chỉnh thời điểm bắt đầu','Giữ nguyên giọng nói. Bạn tải và tự gửi tệp.','Video và SRT có sẵn: không cần chép lại.','Kiểm tra','Sửa chữa','Đào tạo','Sửa SRT'],
};
const phrases: Record<string, string[]> = {
  'es-419': ['La membrana está levantada unos 5 cm junto al bajante.','Cambiamos la bomba de agua. Revise el refrigerante cada mes.','Bloquee la máquina antes de abrir la guarda.'],
  'en-US': ['The membrane is lifted about 5 cm next to the downspout.','We replaced the water pump. Check the coolant every month.','Lock out the machine before opening the guard.'],
  'pt-BR': ['A membrana está levantada cerca de 5 cm junto ao condutor.','Trocamos a bomba de água. Verifique o líquido de arrefecimento mensalmente.','Bloqueie a máquina antes de abrir a proteção.'],
  fr: ['La membrane est soulevée d’environ 5 cm près de la descente.','Nous avons remplacé la pompe à eau. Vérifiez le liquide de refroidissement chaque mois.','Consignez la machine avant d’ouvrir le protecteur.'],
  de: ['Die Membran ist neben dem Fallrohr etwa 5 cm angehoben.','Wir haben die Wasserpumpe ausgetauscht. Prüfen Sie das Kühlmittel monatlich.','Sichern Sie die Maschine vor dem Öffnen der Schutzabdeckung.'],
  ar: ['الغشاء مرتفع بنحو 5 سم بجانب أنبوب التصريف.','استبدلنا مضخة المياه. افحص سائل التبريد كل شهر.','اعزل طاقة الآلة قبل فتح الواقي.'],
  ja: ['縦樋のそばで膜が約5cm浮いています。','ウォーターポンプを交換しました。毎月冷却液を確認してください。','ガードを開ける前に機械をロックアウトしてください。'],
  ko: ['배수관 옆 방수막이 약 5cm 들떠 있습니다.','워터 펌프를 교체했습니다. 매달 냉각수를 확인하세요.','보호대를 열기 전에 기계를 잠금 조치하세요.'],
  'zh-Hans': ['落水管旁的膜翘起约5厘米。','我们更换了水泵。请每月检查冷却液。','打开防护罩前，请锁定机器。'],
  vi: ['Màng bị nhấc lên khoảng 5 cm cạnh ống thoát nước.','Chúng tôi đã thay bơm nước. Hãy kiểm tra nước làm mát mỗi tháng.','Khóa nguồn máy trước khi mở tấm chắn.'],
};
export function renderHeroV2(locale: string, registration: string, languageName: string) {
  const values = strings[locale];
  if (!values || values.length !== keys.length || !phrases[locale]) throw Error('Incomplete hero locale: ' + locale);
  const t = Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<typeof keys[number], string>;
  const english = locale === 'en-US';
  const target = english ? 'es' : 'en';
  const corrections = english ? [
    ['La ', 'tela', 'membrana', ' está levantada unos 5 cm junto al bajante.'],
    ['Cambiamos la ', 'bomba de aire', 'bomba de agua', '. Revise el refrigerante cada mes.'],
    ['Bloquee la máquina antes de abrir el ', 'guardián', 'protector', '.'],
  ] : [
    ['The ', 'fabric', 'membrane', ' is lifted about 5 cm next to the downspout.'],
    ['We replaced the ', 'water bomb', 'water pump', '. Check the coolant every month.'],
    ['Lock out the machine before opening the ', 'guardian', 'guard', '.'],
  ];
  const names = [t.inspection, t.repair, t.training, t.subtitle];
  const icons = ['inspection', 'repair', 'training', 'srt'];
  const connector = (index: number) => '<div class="scene-connector connector-' + index + '" aria-hidden="true"><i></i><span></span>' + marketingIcon('arrow') + '</div>';
  const scenes = names.map((name, index) => {
    const imported = index === 3;
    const [prefix, bad, good, suffix] = imported ? ['', '00:00:05,900', '00:00:05,400', ''] : corrections[index];
    const filename = ['inspection', 'repair', 'training', 'tutorial'][index];
    const output = imported ? good : prefix + good + suffix;
    const correction = '<span>' + escape(prefix) + '</span><del class="scene-wrong">' + escape(bad) + '</del> <ins class="scene-correction">' + escape(good) + '</ins><span>' + escape(suffix) + '</span>';
    return '<section class="hero-scene" id="hero-scene-' + index + '" data-scene-panel="' + index + '" role="tabpanel" aria-labelledby="hero-tab-' + index + '">' +
      '<div class="scene-node node-input"><span class="scene-label">' + marketingIcon(imported ? 'srt' : 'video') + escape(imported ? t.imported : t.input) + '</span><div class="scene-card">' +
      '<div class="scene-video">' + marketingIcon(icons[index]) + '<span>' + escape(name) + '</span></div><p class="scene-file"><bdi dir="ltr">' + filename + '.mp4</bdi></p>' +
      (imported ? '<p class="scene-file"><bdi dir="ltr">tutorial.srt</bdi></p>' : '<p class="scene-language">' + escape(t.source) + ': <bdi>' + escape(languageName) + '</bdi></p>') + '</div></div>' + connector(1) +
      '<div class="scene-node node-review"><span class="scene-label">' + marketingIcon('edit') + escape(t.review) + '</span><div class="scene-card"><p class="scene-field-label">' + escape(imported ? t.timing : t.original) + '</p>' +
      '<p dir="auto">' + escape(imported ? t.timing : phrases[locale][index]) + '</p><p class="scene-field-label">' + escape(imported ? t.subtitle : t.translation) + '</p>' +
      '<p class="scene-edit" lang="' + (imported ? locale : target) + '" dir="' + (imported ? 'ltr' : 'auto') + '">' + correction + '</p>' +
      '<div class="scene-feedback"><span class="scene-activity">' + escape(t.correcting) + '<i aria-hidden="true"></i></span><span class="scene-done">' + marketingIcon('check') + escape(t.corrected) + '</span></div></div></div>' + connector(2) +
      '<div class="scene-node node-result"><span class="scene-label">' + marketingIcon('download') + escape(t.result) + '</span><div class="scene-card"><div class="scene-video scene-output"><span lang="' + (imported ? locale : target) + '" dir="auto">' + escape(output) + '</span></div>' +
      '<p class="scene-file"><bdi dir="ltr">' + filename + '.' + (imported ? locale.toLowerCase() + '.srt' : target + '.mp4') + '</bdi></p><p class="scene-language">' + escape(imported ? t.imported : t.sameVoice) + '</p></div></div></section>';
  }).join('');
  return '<section class="hero-v2 wrap" data-hero-widget data-phase="result" data-motion="static"><div class="hero-v2-heading"><h1>' + escape(t.title) + '</h1><p class="lead">' + escape(t.intro) + '</p>' +
    '<div class="actions"><a class="primary" href="' + registration + '">' + startIcon + escape(t.start) + '</a><a class="secondary" href="#plans">' + priceIcon + escape(t.prices) + '</a></div><p class="hero-package-note">' + escape(commercialTopCopy[locale][5]) + '</p></div>' +
    '<div class="hero-tabs" role="tablist" aria-label="' + escape(t.tabs) + '">' + names.map((name, index) => '<button type="button" role="tab" id="hero-tab-' + index + '" aria-controls="hero-scene-' + index + '" aria-selected="' + (index === 0) + '" data-scene-target="' + index + '">' + marketingIcon(icons[index]) + escape(name) + '<i aria-hidden="true"></i></button>').join('') + '</div>' +
    '<div class="hero-storyboard">' + scenes + '</div><div class="motion-controls"><p>' + escape(t.illustrative) + '</p><button type="button" data-motion-toggle data-play-label="' + escape(t.play) + '" data-pause-label="' + escape(t.pause) + '">' + escape(t.play) + '</button></div></section>';
}
