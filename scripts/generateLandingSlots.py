from pathlib import Path
from html.parser import HTMLParser
import html,json,re,hashlib,argparse
parser=argparse.ArgumentParser(description='Regenerate localization slots and record evidence separately from historical runs.')
parser.add_argument('--evidence-dir',default='outputs/landing-slots')
args=parser.parse_args()
root=Path('server/pilot-site');s=(root/'claudeLandingEs.ts').read_text(encoding='utf-8');body=json.loads(re.search(r'claudeLandingEsBody = (".*");',s)[1]);out=Path(args.evidence_dir);out.mkdir(parents=True,exist_ok=True)
class Extract(HTMLParser):
 def __init__(self):
  super().__init__(convert_charrefs=True);self.stack=[];self.slots=[];self.catalog={};self.bytext={};self.lines=[0]+[m.end()for m in re.finditer('\n',body)]
 def pos(self):
  line,col=self.getpos();return self.lines[line-1]+col
 def add(self,a,b,kind,key=''):
  self.slots.append({'start':a,'end':b,'kind':kind,**({'key':key}if key else{})})
 def translated(self,a,b,value,context):
  if not value.strip():return
  stripped=value.strip()
  if stripped not in self.bytext:
   key=f't{len(self.catalog):03d}';self.bytext[stripped]=key;self.catalog[key]={'source':stripped,'context':context}
  self.add(a,b,'attribute' if ' @' in context else 'text',self.bytext[stripped])
 def context(self):return ' > '.join(n['tag']+('['+n['attrs'].get('data-scene-panel','')+']'if'data-scene-panel'in n['attrs']else'')+('.'+n['attrs'].get('class','').replace(' ','.')if n['attrs'].get('class')else'')for n in self.stack[-6:])
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs);start=self.pos();raw=self.get_starttag_text();end=start+len(raw);in_skip=any(n['special']for n in self.stack);special=None
  if not in_skip:
   if tag=='h1':special='headline'
   elif tag=='ul' and'lgrid'in attrs.get('class','').split():special='catalog'
   elif tag=='select'and'data-site-language'in attrs:special='options'
   elif tag=='nav'and'ftl'in attrs.get('class','').split():special='footer'
   for m in re.finditer(r'([\w-]+)="([^"]*)"',raw):
    name,val=m[1],m[2];a,b=start+m.start(2),start+m.end(2)
    if name in ['aria-label','alt','title','placeholder','data-play-label','data-pause-label','data-results-label','data-result-singular'] and val:
     self.translated(a,b,html.unescape(val),self.context()+' > '+tag+' @'+name)
    elif name=='href'and val.startswith('/pilot/'):
     self.add(a,b,'pilotLink')
    elif name=='href'and val=='/es-419/subtitulos-video/':self.add(a,b,'homeLink')
    elif name=='lang'and val=='en':self.add(a,b,'targetLang')
   scene=next((n['attrs']['data-scene-panel']for n in self.stack if'data-scene-panel'in n['attrs']),None)
   if tag=='p'and('sub'in attrs.get('class','').split()or attrs.get('data-design-style')=='cd-inline-14')and scene is not None and'lang'not in attrs:
    self.add(end-1,end-1,'sourceLangInsert' if scene=='3'else'targetLangInsert')
   if tag=='p'and'pnum'in attrs.get('class','').split()and'dir'not in attrs:self.add(end-1,end-1,'ltrInsert')
  node={'tag':tag,'attrs':attrs,'start':start,'openEnd':end,'special':special if not in_skip else 'nested'}
  if tag not in ['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']:self.stack.append(node)
 def handle_startendtag(self,tag,attrs):
  self.handle_starttag(tag,attrs)
  if self.stack and self.stack[-1]['tag']==tag:self.stack.pop()
 def handle_endtag(self,tag):
  if not self.stack or self.stack[-1]['tag']!=tag:raise ValueError('Unexpected end '+tag)
  n=self.stack.pop()
  if n['special']and n['special']!='nested':self.add(n['openEnd'],self.pos(),n['special'])
  if tag=='nav'and n['attrs'].get('aria-label')=='Producto':self.add(self.pos(),self.pos(),'demoLinks')
 def handle_data(self,data):
  if not data.strip()or any(n['special']for n in self.stack):return
  start=self.pos();end=body.find('<',start);end=end if end>=0 else len(body);raw=body[start:end]
  if not html.unescape(raw).strip():return
  stripped=html.unescape(raw).strip()
  if re.search(r'\.(mp4|srt)$',stripped):
   if re.search(r'\.(en|es)\.(mp4|srt)$',stripped):self.add(start,end,'filename','source' if '.es.' in stripped else 'target')
   return
  if stripped in ('LinguistVision','Vistavo')or re.fullmatch(r'[\W\d_]+',stripped)or re.search(r'\.(mp4|srt)$',stripped)or re.fullmatch(r'US\$[\d,.]+',stripped):return
  left=len(raw)-len(raw.lstrip());right=len(raw.rstrip());self.translated(start,end,html.unescape(raw[left:right]),self.context())
e=Extract();e.feed(body);assert not e.stack
slots=sorted(e.slots,key=lambda n:(n['start'],n['end']));last=0
for n in slots:
 assert n['start']>=last,(n,last)
 last=n['end'];n['start']=len(body[:n['start']].encode('utf-16-le'))//2;n['end']=len(body[:n['end']].encode('utf-16-le'))//2
meta={'sourceSha256':hashlib.sha256(body.encode()).hexdigest(),'slots':slots}
(out/'translation-source.json').write_text(json.dumps(e.catalog,ensure_ascii=False,indent=2),encoding='utf-8');(out/'slot-manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
(root/'landingSlots.ts').write_text('// Generated from the approved Spanish body; regenerate when that template changes.\nexport type LandingSlotKind = "text" | "attribute" | "sourceLangInsert" | "ltrInsert" | "demoLinks" | "filename" | "pilotLink" | "homeLink" | "targetLang" | "targetLangInsert" | "headline" | "catalog" | "options" | "footer";\nexport interface LandingSlot { start: number; end: number; kind: LandingSlotKind; key?: string; }\nexport const landingSourceHash = '+json.dumps(meta['sourceSha256'])+';\nexport const landingSlots: readonly LandingSlot[] = '+json.dumps(slots,ensure_ascii=True,indent=2)+';\n',encoding='utf-8')
print({'slots':len(slots),'uniqueTexts':len(e.catalog),'sourceHash':meta['sourceSha256']})
