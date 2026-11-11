import { launchLanguages } from '../../config/launchLanguages';

export interface PilotLanguage {
  locale: string;
  searchLanguage: string | null;
  direction: 'ltr' | 'rtl';
  name: string;
  slug: string;
  title: string;
  description: string;
  heading: string;
  descriptionOfPilot: string;
  example?: { heading: string; caption: string };
}

export const pilotLanguages = [
  {
    ...launchLanguages.find(language => language.id === 'en')!,
    slug: 'video-subtitles',
    title: 'Video subtitles for jobsite teams | LinguistVision',
    description: 'Review captions as you watch a short video, then download them as an SRT file.',
    heading: 'Video subtitles for jobsite teams',
    descriptionOfPilot: 'This private preview shows how a crew could review captions before sharing a jobsite video.',
    example: { heading: 'Sample caption from a fictional jobsite video', caption: 'Keep the walkway clear while we move the materials.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'es')!,
    slug: 'subtitulos-video',
    title: 'Subtítulos de video para equipos de obra | LinguistVision',
    description: 'Revisa los subtítulos mientras ves un video corto y descárgalos en un archivo SRT.',
    heading: 'Subtítulos de video para equipos de obra',
    descriptionOfPilot: 'Esta vista previa privada muestra cómo un equipo puede revisar los subtítulos antes de compartir un video de obra.',
    example: { heading: 'Subtítulo de ejemplo para un video ficticio de obra', caption: 'Mantengan libre el paso mientras movemos los materiales.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'ar')!,
    slug: 'ترجمة-الفيديو',
    title: 'نصوص مصاحبة للفيديو لفرق العمل الميداني | LinguistVision',
    description: 'راجع النصوص المصاحبة أثناء مشاهدة مقطع فيديو قصير، ثم نزّلها بصيغة SRT.',
    heading: 'نصوص مصاحبة للفيديو لفرق العمل الميداني',
    descriptionOfPilot: 'توضح هذه المعاينة الخاصة كيف يمكن للفريق مراجعة النص المصاحب قبل مشاركة مقطع من موقع العمل.',
    example: { heading: 'مثال لنص مصاحب لمقطع فيديو افتراضي من موقع العمل', caption: 'أبقوا الممر خاليًا أثناء نقل المواد.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'pt')!,
    "slug": "legendas-de-video",
    "title": "Legendas de vídeo para equipes de obra | LinguistVision",
    "description": "Ao assistir a um vídeo curto, revise as legendas e baixe o arquivo SRT.",
    "heading": "Legendas de vídeo para equipes de obra",
    "descriptionOfPilot": "Esta prévia privada mostra como revisar as legendas antes de compartilhar um vídeo da obra.",
    example: { heading: 'Exemplo de legenda de um vídeo fictício de obra', caption: 'Mantenham a passagem livre enquanto transportamos os materiais.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'fr')!,
    "slug": "sous-titres-video",
    "title": "Sous-titres vidéo pour les équipes de chantier | LinguistVision",
    "description": "Vérifiez les sous-titres en regardant une courte vidéo, puis téléchargez-les au format SRT.",
    "heading": "Sous-titres vidéo pour les équipes de chantier",
    "descriptionOfPilot": "Cet aperçu privé montre comment vérifier les sous-titres avant de partager une vidéo de chantier.",
    example: { heading: 'Exemple de sous-titre pour une vidéo fictive de chantier', caption: 'Laissez le passage dégagé pendant que nous déplaçons les matériaux.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'de')!,
    "slug": "video-untertitel",
    "title": "Videountertitel für Baustellenteams | LinguistVision",
    "description": "Prüfen Sie die Untertitel beim Ansehen eines kurzen Videos und laden Sie die SRT-Datei herunter.",
    "heading": "Videountertitel für Baustellenteams",
    "descriptionOfPilot": "Diese private Vorschau zeigt, wie Sie die Untertitel prüfen können, bevor Sie ein Baustellenvideo teilen.",
    example: { heading: 'Beispieluntertitel für ein fiktives Baustellenvideo', caption: 'Halten Sie den Durchgang frei, während wir das Material transportieren.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'ja')!,
    "slug": "動画字幕",
    "title": "現場チーム向け動画字幕 | LinguistVision",
    "description": "短い動画を見ながら字幕を確認し、SRTファイルとしてダウンロードできます。",
    "heading": "現場チーム向け動画字幕",
    "descriptionOfPilot": "この非公開プレビューでは、作業現場の動画を共有する前に字幕を確認する方法を紹介します。",
    example: { heading: '架空の作業現場動画の字幕例', caption: '資材を運んでいる間は、通路を空けておいてください。' },
  },
  {
    ...launchLanguages.find(language => language.id === 'ko')!,
    "slug": "동영상-자막",
    "title": "작업 현장 영상 자막 | LinguistVision",
    "description": "짧은 동영상을 보며 자막을 확인하고 SRT 파일로 다운로드하세요.",
    "heading": "작업 현장 영상 자막",
    "descriptionOfPilot": "이 비공개 미리보기에서는 작업 현장 영상을 공유하기 전에 자막을 확인하는 방법을 보여 드립니다.",
    example: { heading: '가상의 작업 현장 영상 자막 예시', caption: '자재를 옮기는 동안 통로를 비워 주세요.' },
  },
  {
    ...launchLanguages.find(language => language.id === 'cmn')!,
    "slug": "视频字幕",
    "title": "施工现场视频字幕 | LinguistVision",
    "description": "边看短视频边检查字幕，再下载 SRT 文件。",
    "heading": "施工现场视频字幕",
    "descriptionOfPilot": "这份内部预览演示如何在分享施工现场视频前校对字幕。",
    example: { heading: '虚构施工视频的字幕示例', caption: '搬运材料时，请保持通道畅通。' },
  },
  {
    ...launchLanguages.find(language => language.id === 'vi')!,
    "slug": "phu-de-video",
    "title": "Phụ đề video cho đội thi công | LinguistVision",
    "description": "Kiểm tra phụ đề khi xem video ngắn rồi tải phụ đề xuống dưới dạng tệp SRT.",
    "heading": "Phụ đề video cho đội thi công",
    "descriptionOfPilot": "Bản xem trước riêng tư này minh họa cách kiểm tra phụ đề trước khi chia sẻ video công trường.",
    example: { heading: 'Phụ đề mẫu cho video công trường minh họa', caption: 'Vui lòng giữ lối đi thông thoáng khi chúng tôi vận chuyển vật liệu.' },
  },
] as const satisfies readonly PilotLanguage[];
