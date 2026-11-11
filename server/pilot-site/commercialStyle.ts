import { claudeLandingEsStyle } from './claudeLandingEs';
import { commercialV2Style } from './commercialV2Style';
const commercialBaseStyle = `
:root{color-scheme:light;--paper:#fff;--wash:#f7f8fa;--ink:#111827;--soft:#4b5563;--line:#e5e7eb;--field:#8a919c;--accent:#0f6b45;--accent-hover:#0a4d32;--selection:#eaf5ee;font:100%/1.55 "Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body.commercial{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.55 "Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-wrap:anywhere}
.commercial .wrap{width:100%;max-width:70rem;margin-inline:auto;padding-inline:2rem}
.commercial a{color:var(--accent);text-underline-offset:.2em}
.commercial a:focus-visible,.commercial summary:focus-visible,.commercial video:focus-visible{outline:3px solid var(--accent);outline-offset:4px}
.commercial h1,.commercial h2,.commercial h3,.commercial p{margin-block-start:0}
.commercial h1,.commercial h2,.commercial h3{overflow-wrap:anywhere;line-height:1.2}
.commercial h1{font-size:clamp(2rem,3.6vw,2.75rem);letter-spacing:-.025em;font-weight:700;margin-block-end:1.25rem;text-wrap:balance}
.commercial h1>span{display:block}
.commercial h2{font-size:clamp(1.5rem,2.8vw,1.875rem);font-weight:650;letter-spacing:-.015em;margin-block-end:1rem;text-wrap:balance}
.commercial h3{font-size:1.0625rem;font-weight:650;margin-block-end:.5rem}
.commercial p{margin-block-end:1rem}
.commercial .skip-link{position:absolute;inset-block-start:-10rem;inset-inline-start:1rem;z-index:20;padding:.75rem 1rem;background:#fff}
.commercial .skip-link:focus{inset-block-start:1rem}
.commercial .top{border-block-end:1px solid var(--line);background:#fff}
.commercial .top>.wrap{display:flex;align-items:center;gap:1.5rem;min-height:4.75rem;padding-block:.65rem}
.commercial .brand{display:inline-flex;align-items:center;gap:.6rem;min-height:2.75rem;color:var(--ink);font-size:1.0625rem;font-weight:700;text-decoration:none;white-space:nowrap;direction:ltr}
.commercial .mark{display:grid;place-items:center;width:2rem;height:2rem;border-radius:.5rem;background:var(--accent);color:#fff;font-size:.875rem;font-weight:700}
.commercial .section-nav,.commercial .header-actions{display:flex;align-items:center;gap:1rem;min-width:0}
.commercial .section-nav{margin-inline-start:auto}
.commercial .section-nav a,.commercial .header-actions>a,.commercial .legal a{display:inline-flex;align-items:center;min-height:2.75rem;padding:.35rem .2rem;color:var(--ink);font-size:.875rem;text-decoration:none}
.commercial .header-actions{margin-inline-start:auto}
.commercial .locale-nav details{position:relative}
.commercial .locale-nav summary{display:flex;align-items:center;gap:.5rem;min-height:2.75rem;padding:.5rem .65rem;border:1px solid var(--field);border-radius:.5rem;font-size:.875rem;cursor:pointer;list-style:none}
.commercial .locale-nav summary::after{content:"⌄";font-size:1rem}
.commercial .locale-nav summary::-webkit-details-marker{display:none}
.commercial .locale-nav ul{position:absolute;z-index:10;inset-inline-end:0;width:max-content;max-width:calc(100vw - 2rem);max-height:65vh;overflow:auto;list-style:none;margin:.5rem 0 0;padding:.35rem;border:1px solid var(--line);border-radius:.5rem;background:#fff}
.commercial .locale-nav li a{display:flex;align-items:center;min-height:2.75rem;padding:.5rem .75rem;text-decoration:none}
.commercial .locale-nav a:hover,.commercial .locale-nav [aria-current]{background:var(--selection)}
.commercial .hero{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:2.5rem;align-items:center;padding-block:3.5rem 4rem;background:none}
.commercial .hero-copy{min-width:0}
.commercial .lead{max-width:32rem;font-size:1.125rem;color:#374151;margin-block-end:1.5rem}
.commercial .actions{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}
.commercial .actions a{display:inline-flex;align-items:center;justify-content:center;gap:.6rem;min-height:3rem;max-width:100%;padding:.7rem 1rem;border:1px solid var(--field);border-radius:.5rem;font-size:1rem;font-weight:600;text-align:center;text-decoration:none;overflow-wrap:anywhere}
.commercial .actions .primary{color:#fff;background:var(--accent);border-color:var(--accent)}
.commercial .actions .primary:hover{background:var(--accent-hover);border-color:var(--accent-hover)}
.commercial .actions .secondary{color:var(--ink);background:#fff}
.commercial .actions .secondary:hover{background:var(--wash)}
.commercial .actions svg{width:1.15rem;height:1.15rem;flex-shrink:0}
.commercial .hero-note{font-size:.875rem;color:var(--soft);margin-block:1rem .75rem}
.commercial .hero-proof{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:.35rem .85rem;font-size:.875rem;color:var(--soft)}
.commercial .hero-proof li{display:inline}
.commercial .demo-card{margin:0;padding:0;min-width:0;border:1px solid #d1d5db;border-radius:.75rem;background:#fff;box-shadow:0 1px 3px #11182714;overflow:hidden}
.commercial .demo-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.75rem;border-block-end:1px solid var(--line);font-size:.875rem}
.commercial .demo-toolbar strong{font-weight:600}
.commercial .demo-toolbar bdi{color:var(--soft)}
.commercial .editor-mock{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}
.commercial .demo-video{display:flex;align-items:center;min-width:0;background:#111827}
.commercial .demo-video video{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:contain;background:#111827}
.commercial .edit-preview{min-width:0;padding:.75rem;border-inline-start:1px solid var(--line);font-size:.875rem}
.commercial .edit-time{color:var(--soft);font-size:.875rem;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.commercial .sample-before{padding-block:.5rem .75rem}
.commercial .sample-before p,.commercial .sample-after p{margin-block-end:.35rem;color:var(--soft)}
.commercial .sample-before del{display:block;color:var(--soft);text-decoration-color:var(--soft)}
.commercial .sample-after{border-inline-start:3px solid var(--accent);background:var(--selection);padding:.75rem}
.commercial .sample-after q{display:block;quotes:none}
.commercial mark{background:#d9eddf;color:#111827;padding-inline:.1rem}
.commercial .demo-card figcaption{padding:.75rem;border-block-start:1px solid var(--line);color:var(--soft);font-size:.875rem}
.commercial .demo-card figcaption p{margin-block-end:.25rem}
.commercial .demo-card figcaption a{display:inline-flex;align-items:center;min-height:2.75rem}
.commercial .marketing-section{padding-block:4rem}
.commercial .section-intro{max-width:45rem;margin-block-end:1.75rem}
.commercial .section-intro>p{color:var(--soft);margin-block-end:0}
.commercial .eyebrow{color:var(--accent);font-size:.875rem;font-weight:600;margin-block-end:.5rem}
.commercial .example-section,.commercial .language-section{border-block:1px solid var(--line);background:var(--wash)}
.commercial .roof-steps,.commercial .process-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2rem;list-style:none;padding:0;margin:0}
.commercial .roof-steps li,.commercial .process-list li{min-width:0}
.commercial .roof-steps p,.commercial .process-list p{margin-block-end:0;color:var(--soft)}
.commercial .roof-note,.commercial .review-note{margin-block:1.5rem 0;padding-block-start:1rem;border-block-start:1px solid var(--line);font-size:.875rem;color:var(--soft)}
.commercial .step-number,.commercial .roof-step-number{display:block;color:var(--accent);font-size:.875rem;font-weight:650;margin-block-end:.6rem;font-variant-numeric:tabular-nums}
.commercial .uses-section{padding-block-start:0}
.commercial .use-cases{border-block-start:1px solid var(--line)}
.commercial .use-cases article{display:grid;grid-template-columns:minmax(0,.8fr) repeat(3,minmax(0,1fr));gap:1.5rem;align-items:start;padding-block:1.5rem;border-block-end:1px solid var(--line)}
.commercial .use-cases h3,.commercial .use-cases p{margin:0;font-size:1rem}
.commercial .case-problem,.commercial .case-solution,.commercial .case-outcome{color:var(--soft)}
.commercial .language-layout{display:grid;grid-template-columns:1fr 1fr;gap:3rem}
.commercial .language-layout .section-intro{margin-block-end:0}
.commercial .language-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));list-style:none;margin:0;padding:0;border-block-start:1px solid var(--line)}
.commercial .language-list li{padding:.65rem .5rem .65rem 0;border-block-end:1px solid var(--line);min-width:0;font-size:1rem;overflow-wrap:anywhere}
.commercial .coverage-note{color:var(--soft);font-size:.875rem;margin-block:1rem 0}
.commercial .pricing-layout{display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:start}
.commercial .plan-list{width:100%;border-collapse:collapse;margin-block-end:1rem;table-layout:fixed}
.commercial .plan-list th,.commercial .plan-list td{padding:1rem .75rem;border-block:1px solid var(--line);font-size:1.125rem;text-align:start;overflow-wrap:anywhere}
.commercial .plan-list th{font-weight:400}
.commercial .plan-list td{text-align:end;font-weight:650}
.commercial .unit-price,.commercial .preview-note{font-size:.875rem;color:var(--soft)}
.commercial .pricing-notes{padding-block-start:.25rem}
.commercial .balance-example{font-size:1rem;color:var(--soft)}
.commercial .pilot-condition{padding:1rem;border:1px solid var(--line);border-radius:.5rem;margin-block-start:1.5rem}
.commercial .pilot-condition p{font-size:.875rem;color:var(--soft);margin-block-end:0}
.commercial .pilot-condition .preview-note{margin-block-start:.75rem}
.commercial .faq-section{padding-block-start:0}
.commercial .faq-list details{border-block-start:1px solid var(--line)}
.commercial .faq-list details:last-child{border-block-end:1px solid var(--line)}
.commercial .faq-list summary{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:3rem;list-style:none;cursor:pointer;padding:1rem 0;font-weight:600;font-size:1rem}
.commercial .faq-list summary::-webkit-details-marker{display:none}
.commercial .faq-list summary>span{font-size:1.25rem;flex-shrink:0;line-height:1}
.commercial .faq-list details[open] summary>span{transform:rotate(45deg)}
.commercial .faq-list details>p{max-width:70ch;color:var(--soft);margin-block:0 1.25rem}
.commercial .closing{border-block-start:1px solid var(--line)}
.commercial .closing>.wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1.5rem;padding-block:3.5rem}
.commercial .closing>.wrap>div:first-child{max-width:42rem}
.commercial .closing h2{max-width:30ch}
.commercial .closing p{color:var(--soft);margin:0}
.commercial footer{background:var(--wash);border-block-start:1px solid var(--line)}
.commercial footer>.wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem 2rem;padding-block:1.75rem}
.commercial footer p{max-width:36rem;color:var(--soft);font-size:.875rem;margin:0}
.commercial .legal{display:flex;flex-wrap:wrap;gap:1rem}
.commercial:lang(ar),.commercial :lang(ar){font-family:"Noto Sans Arabic",Tahoma,sans-serif;line-height:1.8;letter-spacing:normal}
.commercial:lang(ja),.commercial :lang(ja){font-family:"Noto Sans JP","Yu Gothic",sans-serif;line-height:1.75;line-break:strict;letter-spacing:normal}
.commercial:lang(ko),.commercial :lang(ko){font-family:"Noto Sans KR","Malgun Gothic",sans-serif;word-break:keep-all;line-height:1.75;letter-spacing:normal}
.commercial:lang(zh),.commercial :lang(zh){font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;line-height:1.75;letter-spacing:normal}
.commercial:lang(vi){line-height:1.65}
.commercial:lang(de){hyphens:auto}
.commercial:lang(ar) h1,.commercial:lang(ar) h2,.commercial:lang(ja) h1,.commercial:lang(ja) h2,.commercial:lang(ko) h1,.commercial:lang(ko) h2,.commercial:lang(zh) h1,.commercial:lang(zh) h2{letter-spacing:normal;font-weight:500}
.commercial :lang(en),.commercial :lang(es),.commercial :lang(pt),.commercial :lang(fr),.commercial :lang(de),.commercial :lang(vi){font-family:"Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
[dir=rtl] .commercial .actions svg{transform:scaleX(-1)}
@media(max-width:64rem){.commercial .hero{grid-template-columns:1fr;gap:2rem}.commercial .hero-copy{max-width:45rem}.commercial .demo-card{width:100%;max-width:48rem}.commercial .section-nav{display:none}}
@media(max-width:48rem){.commercial .wrap{padding-inline:1rem}.commercial .top>.wrap{flex-wrap:wrap;gap:.5rem 1rem;padding-block:.5rem}.commercial .header-actions{flex-wrap:wrap;gap:.5rem}.commercial .header-actions>a{font-size:.875rem}.commercial .hero{padding-block:2.75rem}.commercial h1{font-size:clamp(2rem,7vw,2.75rem)}.commercial .marketing-section{padding-block:2.75rem}.commercial .uses-section,.commercial .faq-section{padding-block-start:0}.commercial .language-layout,.commercial .pricing-layout{grid-template-columns:1fr;gap:1.5rem}.commercial .roof-steps,.commercial .process-list{gap:1.25rem}.commercial .use-cases article{grid-template-columns:1fr 1fr;gap:.75rem 1.25rem}.commercial .use-cases h3{grid-column:1/-1}.commercial .case-outcome{grid-column:1/-1}.commercial .closing>.wrap{padding-block:2.75rem}}
@media(max-width:35rem){.commercial .editor-mock,.commercial .roof-steps,.commercial .process-list{grid-template-columns:1fr}.commercial .edit-preview{border-inline-start:0;border-block-start:1px solid var(--line)}.commercial .demo-video video{aspect-ratio:16/9}.commercial .demo-toolbar{align-items:start}.commercial .use-cases article{grid-template-columns:1fr}.commercial .use-cases h3,.commercial .case-outcome{grid-column:auto}.commercial .roof-steps,.commercial .process-list{gap:1.5rem}.commercial .actions{align-items:stretch}.commercial .actions a{flex-grow:1}.commercial .closing .actions{width:100%}.commercial .brand{font-size:1rem}.commercial .locale-nav summary{padding-inline:.5rem}.commercial .plan-list th,.commercial .plan-list td{padding-inline:.5rem}}
@media(prefers-reduced-motion:reduce){.commercial *,.commercial *::before,.commercial *::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

export const commercialStyle = commercialBaseStyle + commercialV2Style + claudeLandingEsStyle;
