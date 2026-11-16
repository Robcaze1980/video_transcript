// Additions are scoped to the nine new locale previews; the approved ES styles remain intact.
export const localizedLandingStyle = `
.claude-landing:lang(ar){font-family:"Noto Sans Arabic",Tahoma,system-ui,sans-serif;line-height:1.8}
.claude-landing:lang(ar) h1,.claude-landing:lang(ar) h2{letter-spacing:normal!important;line-height:1.35!important}
.claude-landing:lang(ar) .lsel select{padding-inline:38px 36px}
.claude-landing:lang(ar) .lsel .lg{left:auto;right:13px}
.claude-landing:lang(ar) .lsel .lc{right:auto;left:13px}
.claude-landing:lang(ar) .ln{transform:scaleX(-1)}
.claude-landing:lang(ar) .tab i,.claude-landing:lang(ar) .hs i b{transform-origin:right center}
.claude-landing:lang(ar) .lgrid li{padding-inline:0 12px}
.claude-landing [dir=ltr]{unicode-bidi:isolate}
.claude-landing:lang(ja){font-family:"Noto Sans JP",system-ui,sans-serif;line-height:1.75;line-break:strict}
.claude-landing:lang(ko){font-family:"Noto Sans KR",system-ui,sans-serif;line-height:1.65;word-break:keep-all}
.claude-landing:lang(zh-Hans){font-family:"Noto Sans SC",system-ui,sans-serif;line-height:1.75}
.claude-landing:lang(vi){line-height:1.65}
.claude-landing:lang(ja) h1,.claude-landing:lang(ko) h1,.claude-landing:lang(zh-Hans) h1{letter-spacing:normal!important;line-height:1.25!important}
.claude-landing:lang(de) button,.claude-landing:lang(de) .b,.claude-landing:lang(de) .b2{hyphens:auto;overflow-wrap:anywhere}
@media(max-width:960px){.claude-landing:lang(ar) .ln{transform:rotate(90deg)}}
`;
