export const landingStyle = `
:root{color-scheme:light;--ink:#172a31;--soft:#4e656c;--line:#d6e4e2;--accent:#075c50;--wash:#f0f7f5;--paper:#fbfdfb;font:16px/1.55 system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink)}
a{color:var(--accent);text-underline-offset:.22em}a:focus-visible,summary:focus-visible{outline:3px solid #208573;outline-offset:5px}
.wrap{max-width:78rem;margin:auto;padding-inline:clamp(1rem,4vw,3.5rem)}
.top{border-bottom:1px solid var(--line)}.top .wrap{min-height:4.75rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.brand{font-size:1.12rem;font-weight:800;display:inline-flex;align-items:center;gap:.65rem;letter-spacing:-.02em}
.mark{display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:.65rem;background:var(--accent);color:white;font-weight:850;font-size:.86rem}
details{position:relative}summary{cursor:pointer;border:1px solid var(--line);border-radius:.6rem;padding:.4rem .7rem;color:var(--accent);font-weight:650}
nav ul{position:absolute;z-index:2;inset-inline-end:0;min-width:10rem;max-height:min(65vh,26rem);overflow:auto;list-style:none;margin:.4rem 0 0;padding:.35rem;background:#fff;border:1px solid var(--line);border-radius:.7rem;box-shadow:0 12px 30px #162b311f}
nav a{display:block;padding:.35rem .65rem;border-radius:.4rem;text-decoration:none}nav a:hover,nav [aria-current]{background:var(--wash)}
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:clamp(2rem,5vw,5rem);align-items:center;padding-block:clamp(3.5rem,8vw,7rem);background:radial-gradient(ellipse at 90% 35%,#e3f2eb,transparent 60%)}
.badge{display:inline-block;border:1px solid #b5d6ce;background:#e8f5ef;color:var(--accent);padding:.18rem .65rem;border-radius:3rem;font-size:.8rem;font-weight:750;letter-spacing:.06em}
h1{font-size:clamp(2.4rem,4.8vw,4.85rem);letter-spacing:-.055em;line-height:1.04;margin:.7rem 0 1rem;text-wrap:balance;overflow-wrap:anywhere}
[dir=rtl] h1{letter-spacing:normal;line-height:1.2}
.lead{font-size:clamp(1.1rem,1.6vw,1.3rem);color:var(--soft);max-width:35rem;margin:0 0 1.6rem}
.actions{display:flex;flex-wrap:wrap;gap:.65rem}.actions a{border:1px solid #a8c7c0;border-radius:.7rem;padding:.72rem 1.12rem;font-weight:750;text-decoration:none;background:white}
.actions a.primary,.actions .primary a{background:var(--accent);border-color:var(--accent);color:white}.actions a.primary:hover,.actions .primary a:hover{background:#094b42}.actions>a:not(.primary):hover{background:var(--wash)}.actions a{display:inline-block}
figure{margin:0;padding:.7rem;border:1px solid #b3cfca;background:white;border-radius:1.15rem;box-shadow:0 20px 48px #173f3826;scroll-margin-top:1rem}
.window{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.45rem .65rem .8rem;color:#42625b;font-size:.8rem;font-weight:750}
.dots{display:flex;gap:.25rem}.dots i{width:.45rem;height:.45rem;background:#97b9af;border-radius:50%}
.screen{display:grid;align-content:end;min-height:clamp(13rem,24vw,22rem);padding:1rem;border-radius:.75rem;background:
repeating-linear-gradient(116deg,transparent 0 28px,#a8e7c515 29px 30px,transparent 31px 54px),
linear-gradient(150deg,#244b44,#123138 58%,#0d2228);color:white}
.caption{width:fit-content;max-width:100%;margin:0 auto;background:#091c22;padding:.5rem .8rem;border:1px solid #c4f0db4a;border-radius:.5rem;text-align:center;font-weight:700;overflow-wrap:anywhere}
.caption p{margin:0}
.track{padding:.65rem}.track p{margin:0 0 .4rem;color:var(--soft);font-size:.8rem;font-variant-numeric:tabular-nums}
.timeline{height:.65rem;display:flex;gap:.23rem}.timeline span{background:#d7e7e3;border-radius:.2rem;flex:1}.timeline .active{background:#288674;flex:2}
figcaption{padding:.15rem .65rem .45rem;color:var(--soft);font-size:.83rem}
.steps{border-block:1px solid var(--line);background:#fff;padding-block:1.55rem}
.steps ol{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin:0;padding:0}
.steps li{border:1px solid var(--line);border-radius:.8rem;min-width:0;padding:.9rem;display:flex;align-items:center;gap:.65rem;font-weight:700;overflow-wrap:anywhere}
.steps span{background:var(--wash);color:var(--accent);border-radius:.45rem;padding:.2rem .45rem;font-variant-numeric:tabular-nums}
footer{padding-block:1.2rem;color:var(--soft);font-size:.88rem}footer p{margin:0}
@media(max-width:48rem){.hero{grid-template-columns:1fr;padding-block:2.5rem;gap:2rem}.steps ol{grid-template-columns:1fr}.screen{min-height:14rem}}
`;

export const landingCopy: Partial<Record<string, readonly [example: string, review: string, edit: string, download: string]>> = {
  'en-US': ['See a subtitle example', 'Review your video', 'Edit subtitles', 'Download SRT'],
  'es-419': ['Ver un ejemplo de subtítulos', 'Revisa tu video', 'Corrige los subtítulos', 'Descarga el SRT'],
  ar: ['شاهد مثالًا على النصوص المصاحبة', 'راجع الفيديو', 'عدّل النصوص المصاحبة', 'نزّل ملف SRT'],
  'pt-BR': ['Veja um exemplo de legenda', 'Revise o vídeo', 'Edite as legendas', 'Baixe o arquivo SRT'],
  fr: ['Voir un exemple de sous-titre', 'Vérifiez la vidéo', 'Modifiez les sous-titres', 'Téléchargez le fichier SRT'],
  de: ['Ein Untertitelbeispiel ansehen', 'Video ansehen', 'Untertitel bearbeiten', 'SRT herunterladen'],
  ja: ['字幕の例を見る', '動画を確認', '字幕を編集', 'SRTをダウンロード'],
  ko: ['자막 예시 보기', '동영상 확인', '자막 편집', 'SRT 다운로드'],
  'zh-Hans': ['查看字幕示例', '查看视频', '编辑字幕', '下载 SRT'],
  vi: ['Xem ví dụ phụ đề', 'Xem lại video', 'Chỉnh sửa phụ đề', 'Tải tệp SRT'],
};

