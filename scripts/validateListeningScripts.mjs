#!/usr/bin/env node
/**
 * LV-019.B step 2.1/2.8: OFFLINE validator for the synthetic native-listening scripts.
 *
 * It reads one JSON document (an array of script objects) and checks the shape, the set composition, the
 * speech windows, the declared numeric tokens, the negative control, and the language rules (neutral Latin
 * American Spanish, neutral US English). It never touches the network, never writes anything and NEVER prints
 * the body of a script: a message names the script id, the field and the rule, and quotes at most a short
 * offending term (a forbidden word), never a whole line.
 *
 * Usage: node scripts/validateListeningScripts.mjs [path/to/guiones.json]
 * Exit code 0 when the document passes, 1 otherwise (one message per violation).
 *
 * Specification: docs/specs/LV-019-B-voz-escucha-nativa-en-es.md (protocol v2, sections 1 to 4) and
 * docs/specs/LV-019-B-voz-c0a-hechos-proveedor-20261120.md (WAV format and pace).
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

/** Speech windows in words per kind and language (20-40 s short, 60-90 s long, about 3 min extended). */
export const LIMITS={
  short:{en:[50,100],es:[53,107]},
  long:{en:[150,235],es:[150,235]},
  extended:{en:[420,520],es:[420,520]},
  negative_control:{en:[50,100],es:[53,107]},
};
export const LANGUAGES=Object.freeze(['en','es']);
export const KINDS=Object.freeze(['short','long','extended','negative_control']);
/** One short per topic (twelve), two long, one extended and one short negative control: sixteen per language. */
export const REQUIRED_KINDS=Object.freeze({short:12,long:2,extended:1,negative_control:1});
export const SCRIPTS_PER_LANGUAGE=16;
export const TOKEN_KEYS=Object.freeze(['numbers','dates','money','percents','times']);
const MIN_NEGATIVE_DIFFERENCE=1;
const MAX_NEGATIVE_DIFFERENCE=1;

/**
 * CLOSED list of voseo and peninsular second-person forms. `clauseStart` entries only fire at the start of a
 * clause, because the bare form is also a neutral word (`hace` as a third person, `mira` as a noun).
 */
const VOSEO_TERMS=[
  {term:'vos'},
  {term:'vosotros'},{term:'habéis'},{term:'habeis'},{term:'tenéis'},{term:'teneis'},{term:'podéis'},{term:'podeis'},
  {term:'tenés'},{term:'tenes'},{term:'podés'},{term:'podes'},{term:'querés'},{term:'queres'},{term:'sos'},
  {term:'hacé',clauseStart:true},{term:'hace',clauseStart:true},
  {term:'decime',clauseStart:true},{term:'mirá',clauseStart:true},{term:'mira',clauseStart:true},
  {term:'vení',clauseStart:true},{term:'veni',clauseStart:true},
];
/** CLOSED list of country-flavoured vocabulary. `assent` and `adjective` entries are context bound. */
const REGIONAL_TERMS=[
  {term:'chévere'},{term:'chevere'},{term:'chido'},{term:'guay'},{term:'bacán'},{term:'bacan'},
  {term:'pibe'},{term:'che'},{term:'ahorita'},{term:'ya mismo'},
  {term:'vale',assent:true},{term:'padre',adjective:true},
];
/** Money has to be US dollars; these are the local currencies that must never appear instead. */
const LOCAL_CURRENCIES=['pesos','peso','soles','quetzales','quetzal','colones','lempiras','córdobas','cordobas','bolívares','bolivares','guaraníes','guaranies','reales','euros','euro'];

/** CLOSED list of real technology and construction brands. Case sensitive: only the proper noun is a violation. */
const REAL_BRANDS=[
  'Home Depot','Lowes',"Lowe's",'Apple','Google','Microsoft','Amazon','Meta','Facebook','Instagram','WhatsApp',
  'Samsung','Huawei','Xiaomi','Sony','LG','Intel','Nvidia','Dell','Lenovo','IBM','Oracle','Adobe','TikTok',
  'YouTube','Twitter','Netflix','Tesla','Walmart','Costco','IKEA','McDonald','Coca-Cola','Pepsi','Starbucks',
  'Bosch','Makita','DeWalt','Milwaukee','Ryobi','Stanley','Craftsman','Black & Decker','Black+Decker',
  'Sherwin-Williams','Behr','Valspar','Owens Corning','CertainTeed','Velux','Hilti','Caterpillar','3M',
  'Verizon','AT&T','T-Mobile','PayPal','Mastercard','Visa','Chase',
];
/** TLDs that make a bare `word.tld` shape an address, and the schemes that always are one. */
const URL_TLDS=['com','net','org','io','app','dev','co','info','biz','edu','gov','ai','xyz','shop'];

const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Whole word, accent aware: the literals carry their own accents, so no normalization is needed. */
const wholeWord=value=>new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(?![\\p{L}\\p{N}])`,'iu');
const clauseStart=value=>new RegExp(`(?:^|[.!?;:,]\\s)${escapeRegExp(value)}(?![\\p{L}\\p{N}])`,'iu');

/** Words that are spoken: whitespace separated runs carrying at least one letter or digit (dashes and ellipses are not words). */
export function countWords(text){
  if(typeof text!=='string')return 0;
  return text.split(/\s+/).filter(token=>/[\p{L}\p{N}]/u.test(token)).length;
}

/** Numbers as they are written: a grouped integer keeps its separators and a decimal keeps its point. */
export function numericTokens(text){
  if(typeof text!=='string')return [];
  return text.match(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)??[];
}

/** Personal-data shapes: e-mail, phone, URL, card-like digit runs and postal codes. Returns labels, never the value. */
export function findPersonalData(text){
  if(typeof text!=='string')return [];
  const found=[];
  const email=/\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/iu;
  const scheme=/\b(?:https?|ftp):\/\/\S+/iu;
  const bareHost=new RegExp(`\\b[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.(?:${URL_TLDS.join('|')})\\b`,'iu');
  const phone=/\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/;
  const cardContiguous=/\b\d{13,19}\b/;
  const cardGrouped=/\b\d{4}(?:[ -]\d{4}){2,4}\b/;
  if(email.test(text))found.push('e-mail');
  if(scheme.test(text))found.push('URL');
  else if(bareHost.test(text))found.push('URL');
  if(phone.test(text))found.push('phone');
  if(cardContiguous.test(text)||cardGrouped.test(text))found.push('card');
  // A five digit run is a postal code only when it is not a decimal, a grouped amount or part of a clock.
  const withoutNumbers=text.replace(/\d+\.\d+/g,' ').replace(/\d{1,3}(?:,\d{3})+/g,' ').replace(/\d+:\d+/g,' ');
  if(/\b\d{5}\b/.test(withoutNumbers))found.push('postal-code');
  return found;
}

/** Real brands present in the text, as written (case sensitive, so a common word in lower case is not a brand). */
export function findRealBrands(text){
  if(typeof text!=='string')return [];
  return REAL_BRANDS.filter(brand=>new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(brand)}(?![\\p{L}\\p{N}])`,'u').test(text));
}

/**
 * Clock markers written with a space inside (`a. m.`, `p. m.`). The project writes them closed (`a.m.`, `p.m.`),
 * because the spaced form is what the voice tends to read as two tokens. Spanish texts are not checked: they spell
 * the moment out (`de la mañana`, `de la tarde`).
 */
export function findSpacedClockMarkers(text){
  if(typeof text!=='string')return [];
  const found=[];
  if(/\ba\.\s+m\./iu.test(text))found.push('a. m.');
  if(/\bp\.\s+m\./iu.test(text))found.push('p. m.');
  return found;
}

/**
 * Encoding damage. Text is expected to be well-formed UTF-8: an accented letter is a single code point, never the
 * two-character mojibake that appears when UTF-8 bytes are read as Latin-1 (`Ã©` for `é`, `Ã±` for `ñ`, `Â¿` for `¿`),
 * and never the replacement character. This rule only rejects damage; it does not constrain the script to ASCII, so a
 * Spanish name inside an English script can keep its accents.
 */
export function findEncodingDamage(text){
  if(typeof text!=='string')return [];
  const found=[];
  if(text.includes('\uFFFD'))found.push('replacement-character');
  if(/\u00C3[\u0080-\u00BF\u0192\u201A-\u2122]|\u00C2[\u00A0-\u00BF\u2018-\u2122]/.test(text))found.push('mojibake');
  return found;
}

/**
 * Voseo, peninsular and country-flavoured terms present in the text, as written and lower cased. The categories
 * are kept separate so the script rule can report `voseo` and `regionalism` apart.
 */
export function findVoseoOrRegional(text){
  return [...findVoseo(text),...findRegional(text)];
}
export function findVoseo(text){
  if(typeof text!=='string')return [];
  return VOSEO_TERMS.filter(entry=>matchTerm(text,entry)).map(entry=>entry.term.toLowerCase());
}
export function findRegional(text){
  if(typeof text!=='string')return [];
  return REGIONAL_TERMS.filter(entry=>matchTerm(text,entry)).map(entry=>entry.term.toLowerCase());
}
export function findLocalCurrencies(text){
  if(typeof text!=='string')return [];
  return LOCAL_CURRENCIES.filter(currency=>wholeWord(currency).test(text));
}

function matchTerm(text,entry){
  if(entry.assent)return new RegExp(`(?:^|[.!?;:]\\s)${escapeRegExp(entry.term)}(?=\\s*[,;:]|\\s*$)`,'iu').test(text);
  if(entry.adjective)return new RegExp(`\\b(?:muy|tan|bien|qué|que|más|mas)\\s+${escapeRegExp(entry.term)}(?![\\p{L}\\p{N}])`,'iu').test(text);
  if(entry.clauseStart)return clauseStart(entry.term).test(text);
  return wholeWord(entry.term).test(text);
}

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isNonEmptyString=value=>typeof value==='string'&&value.trim().length>0;

/**
 * Validates a whole document. `options.requireFullSet` (default true) checks sixteen scripts per language in the
 * required mix; a fixture can switch it off to test one rule at a time. Returns
 * `{ok, violations, counts, kinds}` where every violation is `{rule, id, message}` and no message quotes a script.
 */
export function validateScripts(scripts,options={}){
  const requireFullSet=options.requireFullSet!==false;
  const violations=[];
  const add=(rule,id,message)=>violations.push({rule,id,message});
  if(!Array.isArray(scripts)){
    add('document','<document>','the document is not an array of scripts');
    return {ok:false,violations,counts:{en:0,es:0},kinds:{en:{},es:{}}};
  }
  const seenIds=new Map();
  const tally={en:{},es:{}},counts={en:0,es:0};
  scripts.forEach((script,index)=>{
    const id=isNonEmptyString(script?.id)?script.id:`#${index}`;
    if(!isRecord(script)){add('schema',id,'the entry is not an object');return;}
    const shapeOk=checkShape(script,id,add);
    if(!shapeOk)return;
    if(seenIds.has(script.id))add('duplicate-id',id,`the id is already used by ${seenIds.get(script.id)}`);
    else seenIds.set(script.id,id);
    counts[script.language]++;tally[script.language][script.kind]=(tally[script.language][script.kind]??0)+1;
    checkWords(script,id,add);
    checkExpectedTokens(script,id,add);
    checkContent(script,id,add);
    if(script.kind==='negative_control')checkNegativeControl(script,id,add);
  });
  if(requireFullSet)checkFullSet(counts,tally,add);
  return {ok:violations.length===0,violations,counts,kinds:{en:{...tally.en},es:{...tally.es}}};
}

function checkShape(script,id,add){
  const missing=[];
  if(!isNonEmptyString(script.id))missing.push('id');
  if(!isNonEmptyString(script.topic))missing.push('topic');
  if(!isNonEmptyString(script.notes))missing.push('notes');
  if(!isNonEmptyString(script.text))missing.push('text');
  if(missing.length>0){add('schema',id,`missing or empty field(s): ${missing.join(', ')}`);return false;}
  if(!LANGUAGES.includes(script.language)){add('language',id,`language must be one of ${LANGUAGES.join(', ')}`);return false;}
  if(!KINDS.includes(script.kind)){add('kind',id,`kind must be one of ${KINDS.join(', ')}`);return false;}
  if(!isRecord(script.expectedTokens)){add('schema',id,'expectedTokens must be an object with five arrays');return false;}
  const bad=TOKEN_KEYS.filter(key=>!Array.isArray(script.expectedTokens[key])||script.expectedTokens[key].some(item=>typeof item!=='string'));
  if(bad.length>0){add('schema',id,`expectedTokens needs string arrays for: ${TOKEN_KEYS.join(', ')} (bad: ${bad.join(', ')})`);return false;}
  return true;
}

function checkWords(script,id,add){
  const [min,max]=LIMITS[script.kind][script.language];
  const words=countWords(script.text);
  if(words<min||words>max)add('words',id,`${script.kind} in ${script.language} needs ${min}-${max} words, found ${words}`);
}

function checkExpectedTokens(script,id,add){
  for(const key of TOKEN_KEYS)for(const token of script.expectedTokens[key]){
    if(!script.text.includes(token))add('expected-tokens',id,`${key} token ">${token}<" does not appear literally in the text`);
  }
}

function checkContent(script,id,add){
  for(const field of ['text','referenceText']){
    const value=script[field];
    if(typeof value!=='string')continue;
    const label=field==='text'?'text':'referenceText';
    const personal=findPersonalData(value);
    if(personal.length>0)add('personal-data',id,`${label} looks like it carries ${personal.join(', ')}`);
    const brands=findRealBrands(value);
    if(brands.length>0)add('brand',id,`${label} names the real brand "<${brands.join('>, <')}>"`);
    const damage=findEncodingDamage(value);
    if(damage.length>0)add('encoding',id,`${label} is not well-formed UTF-8 (${damage.join(', ')})`);
    if(script.language==='en'){
      const markers=findSpacedClockMarkers(value);
      if(markers.length>0)add('clock-marker',id,`${label} writes the clock marker with a space: "<${markers.join('>, <')}>"`);
      continue;
    }
    if(script.language!=='es')continue;
    const voseo=findVoseo(value);
    if(voseo.length>0)add('voseo',id,`${label} uses voseo or peninsular forms: "<${voseo.join('>, <')}>"`);
    const regional=findRegional(value);
    if(regional.length>0)add('regionalism',id,`${label} uses regional vocabulary: "<${regional.join('>, <')}>"`);
    const currencies=findLocalCurrencies(value);
    if(currencies.length>0)add('currency',id,`${label} uses a local currency instead of US dollars: "<${currencies.join('>, <')}>"`);
  }
}

/**
 * The negative control is the script that plays one thing and shows another: `referenceText` is what the listener
 * reads, `text` is what the audio says, and the two differ in exactly one cipher, named by `knownDifference`.
 */
function checkNegativeControl(script,id,add){
  if(!isNonEmptyString(script.referenceText)){add('negative-control',id,'the negative control needs a referenceText');return;}
  const shouted=numericTokens(script.text),shown=numericTokens(script.referenceText);
  if(shouted.length!==shown.length){add('negative-control',id,`the two texts hold a different number of figures (${shouted.length} against ${shown.length})`);return;}
  const differing=shouted.map((token,index)=>token===shown[index]?null:index).filter(index=>index!==null);
  if(differing.length<MIN_NEGATIVE_DIFFERENCE||differing.length>MAX_NEGATIVE_DIFFERENCE){
    add('negative-control',id,`the two texts must differ in exactly one figure, they differ in ${differing.length}`);
    return;
  }
  const index=differing[0];
  const heard=shouted[index],reference=shown[index];
  if(heard.length!==reference.length||[...heard].filter((character,position)=>character!==reference[position]).length!==1){
    add('negative-control',id,'the differing figure changes more than one cipher');
    return;
  }
  if(stripFigures(script.text)!==stripFigures(script.referenceText)){
    add('negative-control',id,'the two texts must be identical outside the differing figure');
    return;
  }
  const known=script.knownDifference;
  const digits=value=>String(value??'').replace(/\D/g,'');
  if(!isRecord(known)||digits(known.heard)!==digits(heard)||digits(known.reference)!==digits(reference)){
    add('known-difference',id,'knownDifference does not name the figure that actually changed');
  }
}

const stripFigures=text=>text.replace(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g,'#');

function checkFullSet(counts,tally,add){
  for(const language of LANGUAGES){
    if(counts[language]!==SCRIPTS_PER_LANGUAGE)
      add('counts',language,`${language} needs ${SCRIPTS_PER_LANGUAGE} scripts, found ${counts[language]}`);
    for(const kind of KINDS){
      const found=tally[language][kind]??0;
      if(found!==REQUIRED_KINDS[kind])
        add('counts',language,`${language} needs ${REQUIRED_KINDS[kind]} ${kind} script(s), found ${found}`);
    }
  }
}

export const DEFAULT_SCRIPTS_PATH='docs/reviews/LV-019-B-voz-guiones-escucha-20261120/guiones.json';

/** CLI: validate one document and print one line per violation. Returns the process exit code. */
export function runCli(argv=process.argv.slice(2),log=console.log){
  const target=argv[0]??DEFAULT_SCRIPTS_PATH;
  let document;
  try{
    document=JSON.parse(fs.readFileSync(target,'utf8'));
  }catch(error){
    log(`[document] cannot read ${target}: ${error?.message??'failed'}`);
    return 1;
  }
  const report=validateScripts(document,{requireFullSet:true});
  for(const violation of report.violations)log(`[${violation.rule}] ${violation.id}: ${violation.message}`);
  log(JSON.stringify({ok:report.ok,file:path.basename(target),counts:report.counts,kinds:report.kinds,violations:report.violations.length},null,2));
  return report.ok?0:1;
}

const invokedAsScript=typeof process.argv[1]==='string'&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invokedAsScript)process.exitCode=runCli();

// Kept so a future reader can resolve a relative path the same way the CLI does.
export const resolveFromHere=relative=>path.resolve(path.dirname(fileURLToPath(import.meta.url)),relative);
