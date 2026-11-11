export interface RoofStory {
  label: string;
  title: string;
  intro: string;
  steps: readonly (readonly [string, string])[];
  note: string;
}

export const roofStories: Record<string, RoofStory> = {
  'es-419': {
    label: 'El caso que dio origen a LinguistVision',
    title: 'Una inspección en español. Un cliente que la entiende en inglés.',
    intro: 'Un inspector recorre el techo y explica lo que encuentra con sus propias palabras. Su cliente necesita entender ese mismo mensaje en inglés.',
    steps: [
      ['Graba en español', 'Explica lo que ves en el techo. Tu voz original se conserva.'],
      ['Revisa los subtítulos en inglés', 'La app genera una traducción beta. Tú compruebas frases, materiales, medidas y tiempos.'],
      ['Descarga y envía el video', 'Exporta el MP4 subtitulado y envíalo tú junto al reporte que preparas por separado.'],
    ],
    note: 'Ejemplo español → inglés en beta. No se genera el reporte ni se envía automáticamente. La inclusión comercial del MP4 sigue pendiente.',
  },
  'en-US': {
    label: 'The use case that inspired LinguistVision',
    title: 'An inspection in Spanish. A client who understands it in English.',
    intro: 'An inspector walks the roof and explains the findings in their own words. The client needs to understand that same message in English.',
    steps: [
      ['Record in Spanish', 'Explain what you see on the roof. Your original voice is kept.'],
      ['Review the English subtitles', 'The app generates a beta translation. You check the wording, materials, measurements, and timing.'],
      ['Download and send the video', 'Export the subtitled MP4 and send it yourself with the report you prepare separately.'],
    ],
    note: 'Spanish-to-English example in beta. The report is not generated and the video is not sent automatically. Commercial inclusion of MP4 remains to be confirmed.',
  },
  ar: {
    label: 'حالة الاستخدام التي ألهمت LinguistVision',
    title: 'فحص بالإسبانية. وعميل يفهمه بالإنجليزية.',
    intro: 'يتجول مفتش على السطح ويشرح ما يجده بكلماته. يحتاج عميله إلى فهم الرسالة نفسها بالإنجليزية.',
    steps: [
      ['سجّل بالإسبانية', 'اشرح ما تراه على السطح. يُحتفظ بصوتك الأصلي.'],
      ['راجع النصوص بالإنجليزية', 'يولّد التطبيق ترجمة تجريبية. تتحقق بنفسك من العبارات والمواد والقياسات والتوقيت.'],
      ['نزّل الفيديو وأرسله', 'صدّر ملف MP4 بالنصوص المصاحبة وأرسله بنفسك مع التقرير الذي تعدّه بشكل منفصل.'],
    ],
    note: 'مثال من الإسبانية إلى الإنجليزية في النسخة التجريبية. لا يُنشأ التقرير ولا يُرسل الفيديو تلقائيًا. إدراج MP4 في العرض التجاري ما زال قيد التأكيد.',
  },
  'pt-BR': {
    label: 'O caso que deu origem ao LinguistVision',
    title: 'Uma inspeção em espanhol. Um cliente que a entende em inglês.',
    intro: 'Um inspetor percorre o telhado e explica o que encontra com suas próprias palavras. O cliente precisa entender essa mesma mensagem em inglês.',
    steps: [
      ['Grave em espanhol', 'Explique o que vê no telhado. Sua voz original é mantida.'],
      ['Revise as legendas em inglês', 'O aplicativo gera uma tradução beta. Você confere frases, materiais, medidas e tempos.'],
      ['Baixe e envie o vídeo', 'Exporte o MP4 legendado e envie você mesmo junto ao relatório que prepara separadamente.'],
    ],
    note: 'Exemplo de espanhol para inglês, em beta. O relatório não é gerado e o vídeo não é enviado automaticamente. A inclusão comercial do MP4 ainda será confirmada.',
  },
  fr: {
    label: 'Le cas à l’origine de LinguistVision',
    title: 'Une inspection en espagnol. Un client qui la comprend en anglais.',
    intro: 'Un inspecteur parcourt le toit et explique ses observations avec ses propres mots. Son client doit comprendre ce même message en anglais.',
    steps: [
      ['Filmez en espagnol', 'Expliquez ce que vous observez sur le toit. Votre voix originale est conservée.'],
      ['Vérifiez les sous-titres en anglais', 'L’application génère une traduction bêta. Vous vérifiez les phrases, les matériaux, les mesures et le minutage.'],
      ['Téléchargez et envoyez la vidéo', 'Exportez le MP4 sous-titré et envoyez-le vous-même avec le rapport que vous préparez séparément.'],
    ],
    note: 'Exemple de l’espagnol vers l’anglais, en bêta. Le rapport n’est pas généré et la vidéo n’est pas envoyée automatiquement. L’inclusion du MP4 dans l’offre commerciale reste à confirmer.',
  },
  de: {
    label: 'Der Anwendungsfall, aus dem LinguistVision entstand',
    title: 'Eine Inspektion auf Spanisch. Ein Kunde, der sie auf Englisch versteht.',
    intro: 'Ein Inspektor geht über das Dach und erklärt seine Beobachtungen in eigenen Worten. Sein Kunde muss dieselbe Botschaft auf Englisch verstehen.',
    steps: [
      ['Auf Spanisch aufnehmen', 'Erklären Sie, was Sie auf dem Dach sehen. Ihre Originalstimme bleibt erhalten.'],
      ['Englische Untertitel prüfen', 'Die App erstellt eine Betaübersetzung. Sie prüfen Formulierungen, Materialien, Maße und Zeiten.'],
      ['Video herunterladen und senden', 'Exportieren Sie das untertitelte MP4 und versenden Sie es selbst mit Ihrem separat erstellten Bericht.'],
    ],
    note: 'Beispiel von Spanisch nach Englisch, in der Beta. Der Bericht wird nicht erstellt und das Video nicht automatisch versendet. Ob MP4 zum kommerziellen Angebot gehört, ist noch zu bestätigen.',
  },
  ja: {
    label: 'LinguistVisionが生まれるきっかけとなった使い方',
    title: 'スペイン語の点検動画を、英語の字幕でお客様へ。',
    intro: '点検担当者が屋根を歩き、見つけたことを自分の言葉で説明します。お客様には、その同じ内容を英語で伝える必要があります。',
    steps: [
      ['スペイン語で録画する', '屋根で見たことを説明します。元の音声はそのまま残ります。'],
      ['英語の字幕を確認する', 'アプリがベータ版の翻訳を生成します。文章、材料、寸法、表示時間を自分で確認します。'],
      ['動画をダウンロードして送る', '字幕入りMP4を書き出し、別途作成した報告書と一緒に自分で送ります。'],
    ],
    note: 'スペイン語から英語へのベータ版の例です。報告書の作成や動画の自動送信は行いません。MP4を商用プランに含めるかは今後確定します。',
  },
  ko: {
    label: 'LinguistVision이 시작된 활용 사례',
    title: '스페인어로 한 점검, 영어로 이해하는 고객.',
    intro: '점검 담당자는 지붕을 살펴보며 발견한 내용을 자신의 말로 설명합니다. 고객은 같은 내용을 영어로 이해해야 합니다.',
    steps: [
      ['스페인어로 촬영', '지붕에서 본 내용을 설명하세요. 원래 목소리는 유지됩니다.'],
      ['영어 자막 검토', '앱이 베타 번역을 생성합니다. 문장, 자재, 치수, 표시 시간은 직접 확인하세요.'],
      ['영상 다운로드 후 직접 보내기', '자막이 있는 MP4를 내보내고 별도로 작성한 보고서와 함께 직접 보내세요.'],
    ],
    note: '베타 단계의 스페인어 → 영어 예시입니다. 보고서 생성이나 영상 자동 전송은 제공하지 않습니다. MP4의 상용 상품 포함 여부는 추후 확정됩니다.',
  },
  'zh-Hans': {
    label: 'LinguistVision 起源于这样的使用场景',
    title: '用西班牙语检查屋顶，让客户通过英语字幕了解情况。',
    intro: '检查人员走上屋顶，用自己的话解释发现的情况。客户需要用英语了解同样的信息。',
    steps: [
      ['用西班牙语录制', '说明你在屋顶上看到的情况。视频保留原声。'],
      ['核对英语字幕', '应用生成测试版译文。由你检查句子、材料、尺寸和显示时间。'],
      ['下载并亲自发送视频', '导出字幕 MP4，再亲自随另行编写的报告一起发送。'],
    ],
    note: '这是西班牙语译成英语的测试版示例。应用不会生成报告，也不会自动发送视频。MP4 是否纳入商业方案仍待确认。',
  },
  vi: {
    label: 'Tình huống khởi nguồn của LinguistVision',
    title: 'Kiểm tra bằng tiếng Tây Ban Nha. Khách hàng hiểu bằng tiếng Anh.',
    intro: 'Người kiểm tra đi trên mái nhà và giải thích những gì mình thấy bằng lời của mình. Khách hàng cần hiểu cùng thông điệp đó bằng tiếng Anh.',
    steps: [
      ['Quay bằng tiếng Tây Ban Nha', 'Giải thích những gì bạn thấy trên mái nhà. Giọng nói gốc được giữ nguyên.'],
      ['Kiểm tra phụ đề tiếng Anh', 'Ứng dụng tạo bản dịch beta. Bạn kiểm tra câu chữ, vật liệu, số đo và thời gian.'],
      ['Tải video và tự gửi', 'Xuất MP4 có phụ đề và tự gửi kèm báo cáo bạn chuẩn bị riêng.'],
    ],
    note: 'Ví dụ dịch từ tiếng Tây Ban Nha sang tiếng Anh, trong bản beta. Ứng dụng không tạo báo cáo hay tự động gửi video. Việc đưa MP4 vào gói thương mại còn chờ xác nhận.',
  },
};
