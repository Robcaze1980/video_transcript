import type { RoofStory } from './roofStory';

interface CommercialDesignCopy {
  mockLabel: string;
  languagesLabel: string;
  pilotHeading: string;
  pilotNote: string;
  languageGoal: string;
  title?: readonly [string, string];
  intro?: string;
  roof?: RoofStory;
}

export const commercialDesignCopy: Record<string, CommercialDesignCopy> = {
  'es-419': {
    mockLabel: 'Maqueta ilustrativa del editor',
    languagesLabel: 'Idiomas de la interfaz',
    languageGoal: 'El objetivo es cubrir los otros nueve idiomas desde cada origen. Las direcciones pendientes todavía no se pueden procesar.',
    pilotHeading: 'Condiciones del piloto actual',
    pilotNote: 'Pagos de prueba con PayPal. Videos de hasta 30 segundos y 1 MiB. Los proyectos se conservan 24 horas. La inclusión comercial del MP4 sigue pendiente.',
    title: ['Graba en español.', 'Entrega tu video con subtítulos en inglés.'],
    intro: 'Sube tu video, revisa la traducción beta y corrige los subtítulos antes de descargar. Tu voz original se conserva.',
  },
  'en-US': {
    mockLabel: 'Illustrative editor mockup',
    languagesLabel: 'Interface languages',
    languageGoal: 'The goal is to cover the other nine languages from each source. Pending directions cannot be processed yet.',
    pilotHeading: 'Current pilot conditions',
    pilotNote: 'Test payments with PayPal. Videos up to 30 seconds and 1 MiB. Projects are kept for 24 hours. Commercial inclusion of MP4 remains to be confirmed.',
    title: ['Record in English.', 'Deliver your video with Spanish subtitles.'],
    intro: 'Upload your video, review the beta translation, and correct the subtitles before downloading. Your original voice stays.',
    roof: {
      label: 'An example from roof inspection',
      title: 'The inspector explains in English. The homeowner needs Spanish.',
      intro: 'An inspector records the findings in English. The homeowner can see the footage and needs Spanish subtitles to follow the explanation.',
      steps: [
        ['Record in English', 'Explain what you find on the roof. Your original voice stays.'],
        ['Review the Spanish subtitles', 'Check the beta translation line by line, including materials, measurements, and timing.'],
        ['Download and send the video', 'Export the subtitled MP4 and send it yourself with the report you prepare separately.'],
      ],
      note: 'English-to-Spanish example in beta. The report is prepared separately and you send the video yourself. Commercial inclusion of MP4 remains to be confirmed.',
    },
  },
  ar: {
    mockLabel: 'نموذج توضيحي للمحرر',
    languagesLabel: 'لغات الواجهة',
    languageGoal: 'الهدف هو دعم اللغات التسع الأخرى من كل لغة مصدر. اتجاهات الترجمة المعلّقة غير متاحة للمعالجة بعد.',
    pilotHeading: 'شروط المرحلة التجريبية الحالية',
    pilotNote: 'مدفوعات تجريبية عبر PayPal. مقاطع حتى 30 ثانية وحجم 1 ميبيبايت. تُحفظ المشاريع 24 ساعة. إدراج MP4 في العرض التجاري ما زال قيد التأكيد.',
    title: ['سجّل بالعربية.', 'جهّز الفيديو بنصوص مصاحبة.'],
    intro: 'من الاستخدامات المخططة إضافة نصوص إنجليزية إلى فحص مسجّل بالعربية. هذا الاتجاه ما زال بانتظار التفعيل. يوضح المثال مراجعة الترجمة مع الاحتفاظ بالصوت الأصلي.',
    roof: {
      label: 'مثال مخطط لفحص سطح',
      title: 'شرح بالعربية لعميل يحتاج إلى نصوص بالإنجليزية.',
      intro: 'تخيّل مفتشًا يشرح ما وجده بالعربية، وعميلًا يحتاج إلى قراءة الشرح بالإنجليزية. هذا استخدام مستهدف يحتاج اتجاه ترجمته إلى التفعيل.',
      steps: [
        ['سجّل بالعربية', 'اشرح ما تراه على السطح بكلماتك. يُحتفظ بصوتك الأصلي.'],
        ['راجع النصوص الإنجليزية عند تفعيل الاتجاه', 'يتضمن الاستخدام المخطط مراجعتك للعبارات والمواد والقياسات والتوقيت.'],
        ['نزّل الفيديو وأرسله بنفسك', 'النتيجة المستهدفة فيديو بنصوص مصاحبة ترسله مع تقرير تعدّه بشكل منفصل.'],
      ],
      note: 'مثال مخطط من العربية إلى الإنجليزية، غير مفعّل بعد. لا يمثل عرضًا فعليًا لهذه الترجمة. التقرير والإرسال من مسؤوليتك. إدراج MP4 في العرض التجاري ما زال قيد التأكيد.',
    },
  },
  'pt-BR': {
    mockLabel: 'Maquete ilustrativa do editor',
    languagesLabel: 'Idiomas da interface',
    languageGoal: 'A meta é cobrir os outros nove idiomas a partir de cada origem. As direções pendentes ainda não podem ser processadas.',
    pilotHeading: 'Condições do piloto atual',
    pilotNote: 'Pagamentos de teste com PayPal. Vídeos de até 30 segundos e 1 MiB. Projetos mantidos por 24 horas. A inclusão comercial do MP4 ainda será confirmada.',
    title: ['Grave em português.', 'Prepare seu vídeo com legendas.'],
    intro: 'Um uso previsto é adicionar legendas em inglês a uma inspeção gravada em português. Essa direção ainda aguarda habilitação. O exemplo mostra a revisão da tradução preservando a voz original.',
    roof: {
      label: 'Exemplo previsto de inspeção de telhado',
      title: 'Uma explicação em português para um cliente que precisa ler em inglês.',
      intro: 'Imagine um inspetor explicando o que encontrou em português e um cliente que precisa ler a explicação em inglês. Essa direção de tradução ainda aguarda habilitação.',
      steps: [
        ['Grave em português', 'Explique com suas palavras o que vê no telhado. Sua voz original é mantida.'],
        ['Revise as legendas em inglês quando o par for habilitado', 'O uso previsto inclui conferir frases, materiais, medidas e tempos.'],
        ['Baixe e envie você mesmo', 'O resultado pretendido é um vídeo legendado para enviar junto ao relatório que você prepara separadamente.'],
      ],
      note: 'Exemplo previsto de português para inglês, ainda não habilitado. Não é uma demonstração real dessa tradução. Você prepara o relatório e envia o vídeo. A inclusão comercial do MP4 segue pendente.',
    },
  },
  fr: {
    mockLabel: 'Maquette illustrative de l’éditeur',
    languagesLabel: 'Langues de l’interface',
    languageGoal: 'L’objectif est de couvrir les neuf autres langues depuis chaque langue source. Les directions en attente ne peuvent pas encore être traitées.',
    pilotHeading: 'Conditions du pilote actuel',
    pilotNote: 'Paiements de test avec PayPal. Vidéos de 30 secondes et 1 Mio maximum. Projets conservés 24 heures. L’inclusion du MP4 dans l’offre commerciale reste à confirmer.',
    title: ['Enregistrez en français.', 'Préparez votre vidéo avec des sous-titres.'],
    intro: 'Un usage prévu consiste à ajouter des sous-titres anglais à une inspection filmée en français. Cette direction attend encore son activation. L’exemple décrit la vérification de la traduction en conservant la voix originale.',
    roof: {
      label: 'Exemple prévu d’inspection de toiture',
      title: 'Une explication en français pour un client qui a besoin de la lire en anglais.',
      intro: 'Imaginez un inspecteur décrivant ses observations en français et un client qui doit les lire en anglais. Cette direction de traduction attend encore son activation.',
      steps: [
        ['Filmez en français', 'Décrivez avec vos mots ce que vous observez sur le toit. Votre voix originale est conservée.'],
        ['Vérifiez les sous-titres anglais quand la paire sera activée', 'L’usage prévu comprend la vérification des phrases, des matériaux, des mesures et du minutage.'],
        ['Téléchargez et envoyez vous-même', 'Le résultat visé est une vidéo sous-titrée à envoyer avec le rapport préparé séparément.'],
      ],
      note: 'Exemple prévu du français vers l’anglais, encore inactif. Ce n’est pas une démonstration réelle de cette traduction. Vous préparez le rapport et envoyez la vidéo. L’inclusion commerciale du MP4 reste à confirmer.',
    },
  },
  de: {
    mockLabel: 'Illustratives Modell des Editors',
    languagesLabel: 'Oberflächensprachen',
    languageGoal: 'Ziel ist die Abdeckung der anderen neun Sprachen von jeder Ausgangssprache aus. Ausstehende Richtungen können noch nicht verarbeitet werden.',
    pilotHeading: 'Bedingungen der aktuellen Pilotphase',
    pilotNote: 'Testzahlungen mit PayPal. Videos bis 30 Sekunden und 1 MiB. Projekte werden 24 Stunden aufbewahrt. Ob MP4 zum kommerziellen Angebot gehört, ist noch zu bestätigen.',
    title: ['Auf Deutsch aufnehmen.', 'Ihr Video mit Untertiteln vorbereiten.'],
    intro: 'Ein geplanter Einsatz sind englische Untertitel für eine auf Deutsch gefilmte Inspektion. Diese Richtung ist noch nicht freigeschaltet. Das Beispiel beschreibt die Prüfung der Übersetzung bei erhaltener Originalstimme.',
    roof: {
      label: 'Geplantes Beispiel einer Dachinspektion',
      title: 'Eine Erklärung auf Deutsch für einen Kunden, der Englisch liest.',
      intro: 'Stellen Sie sich einen Inspektor vor, der seine Beobachtungen auf Deutsch erklärt. Sein Kunde braucht englische Untertitel. Diese Übersetzungsrichtung ist noch nicht freigeschaltet.',
      steps: [
        ['Auf Deutsch aufnehmen', 'Beschreiben Sie in eigenen Worten, was Sie auf dem Dach sehen. Ihre Originalstimme bleibt erhalten.'],
        ['Nach der Freischaltung englische Untertitel prüfen', 'Der geplante Ablauf umfasst Ihre Prüfung von Formulierungen, Materialien, Maßen und Zeiten.'],
        ['Herunterladen und selbst versenden', 'Das angestrebte Ergebnis ist ein untertiteltes Video, das Sie mit Ihrem separat erstellten Bericht versenden.'],
      ],
      note: 'Geplantes Beispiel Deutsch → Englisch, noch nicht freigeschaltet. Keine tatsächliche Vorführung dieser Übersetzung. Sie erstellen den Bericht und versenden das Video. Ob MP4 zum kommerziellen Angebot gehört, ist noch offen.',
    },
  },
  ja: {
    mockLabel: 'エディターのイメージ図',
    languagesLabel: '画面の表示言語',
    languageGoal: '各言語から他の9言語への対応を目指しています。未対応の翻訳方向では、まだ処理できません。',
    pilotHeading: '現在の試験運用の条件',
    pilotNote: 'PayPalのテスト決済を使用します。動画は最大30秒、1 MiBです。プロジェクトの保存期間は24時間です。商用プランへのMP4の組み込みは未確定です。',
    title: ['日本語で録画。', '字幕付きの動画を準備しましょう。'],
    intro: '日本語の点検動画に英語字幕を付ける使い方を想定しています。この翻訳方向はまだ利用できません。元の音声を保ち、訳文を確認する流れを例として紹介します。',
    roof: {
      label: '想定している屋根点検の活用例',
      title: '日本語の説明を、英語で読みたいお客様へ。',
      intro: '点検担当者が見つけたことを日本語で説明し、お客様が英語で内容を読む場面を想定しています。この翻訳方向は提供準備中です。',
      steps: [
        ['日本語で録画する', '屋根で見たことを自分の言葉で説明します。元の音声はそのまま残ります。'],
        ['対応後に英語字幕を確認する', '想定する手順には、文章・材料・寸法・表示時間を自分で確認する作業が含まれます。'],
        ['ダウンロードして自分で送る', '目指すのは、別途作成した報告書と一緒に自分で送れる字幕付き動画です。'],
      ],
      note: '日本語から英語への想定例で、まだ利用できません。この翻訳を実行したデモではありません。報告書の作成と動画の送付は利用者が行います。MP4の商用プランへの組み込みは未確定です。',
    },
  },
  ko: {
    mockLabel: '편집기 설명용 목업',
    languagesLabel: '화면 표시 언어',
    languageGoal: '각 원본 언어에서 나머지 아홉 언어로의 지원을 목표로 합니다. 대기 중인 번역 방향은 아직 처리할 수 없습니다.',
    pilotHeading: '현재 시험 운영 조건',
    pilotNote: 'PayPal 테스트 결제를 사용합니다. 영상은 최대 30초, 1 MiB이며 프로젝트는 24시간 보관됩니다. MP4의 상용 상품 포함 여부는 추후 확정됩니다.',
    title: ['한국어로 촬영하세요.', '자막이 있는 영상을 준비하세요.'],
    intro: '한국어 점검 영상에 영어 자막을 추가하는 활용을 계획하고 있습니다. 이 번역 방향은 아직 활성화되지 않았습니다. 원래 목소리를 유지하며 번역을 검토하는 흐름을 예시로 소개합니다.',
    roof: {
      label: '계획 중인 지붕 점검 활용 예시',
      title: '한국어 설명을 영어로 읽어야 하는 고객에게.',
      intro: '점검 담당자가 발견한 내용을 한국어로 설명하고 고객은 영어 자막으로 읽는 상황을 가정합니다. 이 번역 방향은 아직 준비 중입니다.',
      steps: [
        ['한국어로 촬영', '지붕에서 본 내용을 자신의 말로 설명합니다. 원래 목소리는 유지됩니다.'],
        ['지원 후 영어 자막 검토', '계획된 흐름에는 문장, 자재, 치수, 표시 시간을 직접 확인하는 과정이 포함됩니다.'],
        ['다운로드 후 직접 보내기', '별도로 작성한 보고서와 함께 직접 보낼 수 있는 자막 영상을 목표로 합니다.'],
      ],
      note: '한국어 → 영어의 계획된 예시이며 아직 사용할 수 없습니다. 실제 번역 실행을 보여 주는 데모가 아닙니다. 보고서 작성과 영상 전송은 사용자가 직접 합니다. MP4의 상용 상품 포함 여부는 미정입니다.',
    },
  },
  'zh-Hans': {
    mockLabel: '编辑器示意图',
    languagesLabel: '界面语言',
    languageGoal: '目标是支持从每种源语言翻译成其余九种语言。待开放的翻译方向目前还不能处理。',
    pilotHeading: '当前试用条件',
    pilotNote: '使用 PayPal 测试付款。视频最长 30 秒，最大 1 MiB。项目保留 24 小时。MP4 是否纳入商业方案仍待确认。',
    title: ['用中文录制。', '为视频准备字幕。'],
    intro: '计划中的一个用法，是为中文检查视频添加英语字幕。这个翻译方向尚未开放。以下示例介绍保留原声、核对译文的预期流程。',
    roof: {
      label: '计划中的屋顶检查示例',
      title: '用中文讲解，让需要英语字幕的客户了解情况。',
      intro: '设想检查人员用中文说明发现的情况，而客户需要用英语阅读。这是目标使用场景，该翻译方向仍待开放。',
      steps: [
        ['用中文录制', '用自己的话说明屋顶上的情况。视频保留原声。'],
        ['开放后核对英语字幕', '预期流程包括由你核对句子、材料、尺寸和显示时间。'],
        ['下载后亲自发送', '目标结果是字幕视频，由你随另行编写的报告一起发送。'],
      ],
      note: '这是中文译成英语的计划示例，尚未开放，也不是实际执行该翻译的演示。报告由你另行编写，视频由你发送。MP4 是否纳入商业方案仍待确认。',
    },
  },
  vi: {
    mockLabel: 'Mô hình minh họa trình chỉnh sửa',
    languagesLabel: 'Ngôn ngữ giao diện',
    languageGoal: 'Mục tiêu là hỗ trợ chín ngôn ngữ đích còn lại từ mỗi ngôn ngữ nguồn. Các chiều dịch đang chờ chưa thể xử lý.',
    pilotHeading: 'Điều kiện thử nghiệm hiện tại',
    pilotNote: 'Thanh toán thử nghiệm qua PayPal. Video tối đa 30 giây và 1 MiB. Dự án được giữ 24 giờ. Việc đưa MP4 vào gói thương mại còn chờ xác nhận.',
    title: ['Quay bằng tiếng Việt.', 'Chuẩn bị video có phụ đề.'],
    intro: 'Một cách dùng dự kiến là thêm phụ đề tiếng Anh cho video kiểm tra bằng tiếng Việt. Chiều dịch này chưa được bật. Ví dụ mô tả việc kiểm tra bản dịch và giữ nguyên giọng nói gốc.',
    roof: {
      label: 'Ví dụ dự kiến về kiểm tra mái nhà',
      title: 'Lời giải thích bằng tiếng Việt cho khách hàng cần đọc tiếng Anh.',
      intro: 'Hãy hình dung người kiểm tra giải thích những gì thấy bằng tiếng Việt, còn khách hàng cần đọc bằng tiếng Anh. Chiều dịch cho tình huống này vẫn đang chờ được bật.',
      steps: [
        ['Quay bằng tiếng Việt', 'Giải thích bằng lời của bạn những gì thấy trên mái nhà. Giọng gốc được giữ nguyên.'],
        ['Kiểm tra phụ đề tiếng Anh khi được hỗ trợ', 'Quy trình dự kiến gồm việc bạn kiểm tra câu chữ, vật liệu, số đo và thời gian.'],
        ['Tải xuống và tự gửi', 'Kết quả hướng tới là video có phụ đề để bạn tự gửi kèm báo cáo chuẩn bị riêng.'],
      ],
      note: 'Ví dụ dự kiến từ tiếng Việt sang tiếng Anh, chưa được bật. Đây không phải demo đã thực hiện chiều dịch này. Bạn tự chuẩn bị báo cáo và gửi video. Việc đưa MP4 vào gói thương mại còn chờ xác nhận.',
    },
  },
};
