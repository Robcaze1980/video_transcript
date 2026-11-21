import {describe,expect,it} from 'vitest';
import {
  LIMITS,countWords,findPersonalData,findRealBrands,findVoseoOrRegional,
  findEncodingDamage,findSpacedClockMarkers,numericTokens,validateScripts,
} from './validateListeningScripts.mjs';

// The validator is the gate for the synthetic listening scripts of LV-019.B step 2.1/2.8, so every rule it
// claims is exercised here twice: a minimal script that breaks it and a minimal script that satisfies it.
// Fixtures are programmatic and tiny on purpose: a failing rule must be visible without reading a full script.

type Script=Record<string,any>;

/** A script that violates nothing, so a test can add exactly one defect. */
const script=(over:Script={}):Script=>({
  id:'f-01',
  language:'en',
  kind:'short',
  topic:'roof vocabulary',
  text:'roof '.repeat(60).trim(),
  expectedTokens:{numbers:[],dates:[],money:[],percents:[],times:[]},
  notes:'fixture',
  ...over,
});

/** The same neutral script in Spanish, for the Spanish-only rules. */
const spanish=(over:Script={}):Script=>script({id:'f-es',language:'es',topic:'tejados',text:'techo '.repeat(70).trim(),...over});

const rulesOf=(scripts:Script[],options:Record<string,any>={}):string[]=>
  validateScripts(scripts,{requireFullSet:false,...options}).violations.map((violation:any)=>violation.rule);

const words=(language:'en'|'es',count:number):string=>(language==='en'?'roof ':'techo ').repeat(count).trim();

const fill=(language:'en'|'es',count:number):string=>words(language,count);

/** A complete 16-per-language set, so the counting and set-level rules can be judged on a whole document. */
const fullSet=():Script[]=>{
  const out:Script[]=[];
  for(const language of ['en','es'] as const){
    for(let index=1;index<=12;index++)out.push(script({id:`${language}-short-${String(index).padStart(2,'0')}`,language,kind:'short',text:fill(language,60)}));
    for(let index=1;index<=2;index++)out.push(script({id:`${language}-long-${index}`,language,kind:'long',text:fill(language,180)}));
    out.push(script({id:`${language}-extended-1`,language,kind:'extended',text:fill(language,450)}));
    out.push(script({
      id:`${language}-neg-01`,language,kind:'negative_control',text:fill(language,55)+' total 1450 dollars today',
      referenceText:fill(language,55)+' total 1458 dollars today',
      knownDifference:{field:'money',heard:'1450',reference:'1458',note:'one cipher changed on purpose'},
    }));
  }
  return out;
};

describe('word counting and declared limits',()=>{
  it('counts words, not whitespace or dashes',()=>{
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  one   two \n three  ')).toBe(3);
    expect(countWords('one two - three')).toBe(3);
    expect(countWords('uno, dos; tres.')).toBe(3);
  });
  it('keeps the speech-window limits of the protocol',()=>{
    expect(LIMITS.short.en).toEqual([50,100]);
    expect(LIMITS.short.es).toEqual([53,107]);
    expect(LIMITS.long.en).toEqual([150,235]);
    expect(LIMITS.extended.en).toEqual([420,520]);
    expect(LIMITS.negative_control.es).toEqual([53,107]);
  });
});

describe('schema',()=>{
  it('accepts a complete script',()=>{
    expect(rulesOf([script()])).toEqual([]);
  });
  it('rejects a missing field',()=>{
    const broken=script() as any;
    delete broken.topic;
    expect(rulesOf([broken])).toContain('schema');
  });
  it('rejects an unknown kind and an unknown language',()=>{
    expect(rulesOf([script({kind:'medium'})])).toContain('kind');
    expect(rulesOf([script({language:'pt'})])).toContain('language');
  });
  it('rejects a malformed expectedTokens block',()=>{
    expect(rulesOf([script({expectedTokens:{numbers:['1']}})])).toContain('schema');
    expect(rulesOf([script({expectedTokens:{numbers:'1',dates:[],money:[],percents:[],times:[]}})])).toContain('schema');
  });
  it('rejects duplicate ids',()=>{
    expect(rulesOf([script({id:'same'}),script({id:'same',language:'es',text:words('es',70)})])).toContain('duplicate-id');
  });
});

describe('set composition',()=>{
  it('accepts sixteen scripts per language in the required mix',()=>{
    expect(validateScripts(fullSet(),{requireFullSet:true}).violations).toEqual([]);
  });
  it('rejects a language with a missing script',()=>{
    const short=fullSet().filter((item,i)=>!(item.language==='es'&&i%3===0)).slice(0,30);
    expect(validateScripts(short,{requireFullSet:true}).violations.map(v=>v.rule)).toContain('counts');
  });
  it('rejects a wrong kind mix even with sixteen scripts',()=>{
    const doc=fullSet();
    doc[13]={...doc[13],kind:'short'};
    const found=validateScripts(doc,{requireFullSet:true}).violations.filter(v=>v.rule==='counts');
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('word ranges per kind',()=>{
  it('rejects a short script outside its window',()=>{
    expect(rulesOf([script({text:words('en',20)})])).toContain('words');
    expect(rulesOf([script({text:words('en',130)})])).toContain('words');
    expect(rulesOf([spanish({text:words('es',10)})])).toContain('words');
  });
  it('accepts the edges of each window',()=>{
    expect(rulesOf([script({text:words('en',50)})])).not.toContain('words');
    expect(rulesOf([script({text:words('en',100)})])).not.toContain('words');
    expect(rulesOf([spanish({text:words('es',53)})])).not.toContain('words');
    expect(rulesOf([script({language:'en',kind:'long',text:words('en',150)})])).not.toContain('words');
    expect(rulesOf([script({language:'en',kind:'extended',text:words('en',520)})])).not.toContain('words');
  });
  it('rejects a long or extended script outside its window',()=>{
    expect(rulesOf([script({language:'en',kind:'long',text:words('en',100)})])).toContain('words');
    expect(rulesOf([script({language:'en',kind:'extended',text:words('en',300)})])).toContain('words');
  });
});

describe('expected tokens',()=>{
  it('accepts tokens that appear literally in the text',()=>{
    const text=words('en',55)+' paying 1450 dollars on March 3, 2027 at 7:45 a.m.';
    expect(rulesOf([script({text,expectedTokens:{numbers:['1450'],dates:['March 3, 2027'],money:[],percents:[],times:['7:45']}})])).toEqual([]);
  });
  it('rejects a number, date, money, percent or time that is not in the text',()=>{
    const base=words('en',55);
    expect(rulesOf([script({text:base,expectedTokens:{numbers:['1450'],dates:[],money:[],percents:[],times:[]}})])).toContain('expected-tokens');
    expect(rulesOf([script({text:base,expectedTokens:{numbers:[],dates:['March 3, 2027'],money:[],percents:[],times:[]}})])).toContain('expected-tokens');
    expect(rulesOf([script({text:base,expectedTokens:{numbers:[],dates:[],money:['$1,200'],percents:[],times:[]}})])).toContain('expected-tokens');
    expect(rulesOf([script({text:base,expectedTokens:{numbers:[],dates:[],money:[],percents:['15%'],times:[]}})])).toContain('expected-tokens');
    expect(rulesOf([script({text:base,expectedTokens:{numbers:[],dates:[],money:[],percents:[],times:['7:45']}})])).toContain('expected-tokens');
  });
});

describe('negative control',()=>{
  it('accepts a reference that differs by exactly one cipher, named by knownDifference',()=>{
    const text=words('en',55)+' total 1450 dollars today';
    const referenceText=words('en',55)+' total 1458 dollars today';
    expect(rulesOf([script({kind:'negative_control',text,referenceText,knownDifference:{field:'money',heard:'1450',reference:'1458',note:'one cipher changed'}})])).toEqual([]);
  });
  it('rejects a negative control with no referenceText or no knownDifference',()=>{
    expect(rulesOf([script({kind:'negative_control',text:words('en',55)+' total 1450 dollars',referenceText:undefined,knownDifference:undefined})])).toContain('negative-control');
  });
  it('rejects a reference that differs in two ciphers',()=>{
    const text=words('en',55)+' total 1450 dollars today';
    const referenceText=words('en',55)+' total 1570 dollars today';
    expect(rulesOf([script({kind:'negative_control',text,referenceText,knownDifference:{field:'money',heard:'1450',reference:'1570',note:'two digits changed'}})])).toContain('negative-control');
  });
  it('rejects a reference that differs in words instead of one cipher',()=>{
    const text=words('en',55)+' total 1450 dollars today';
    const referenceText=words('en',55)+' sum 1458 dollars today';
    expect(rulesOf([script({kind:'negative_control',text,referenceText,knownDifference:{field:'money',heard:'1450',reference:'1458',note:'word changed'}})])).toContain('negative-control');
  });
  it('rejects a knownDifference that names the wrong pair',()=>{
    const text=words('en',55)+' total 1450 dollars today';
    const referenceText=words('en',55)+' total 1458 dollars today';
    expect(rulesOf([script({kind:'negative_control',text,referenceText,knownDifference:{field:'money',heard:'1450',reference:'1900',note:'wrong pair'}})])).toContain('known-difference');
  });
  it('only asks a negative control of a short script',()=>{
    expect(rulesOf([script({kind:'short',text:words('en',60),referenceText:undefined})])).not.toContain('negative-control');
  });
});

describe('voseo and peninsular forms',()=>{
  it('detects the pronoun vos and its verb forms with and without an accent',()=>{
    expect(findVoseoOrRegional('vos tenés el presupuesto')).toContain('vos');
    expect(findVoseoOrRegional('si vos queres, vamos')).toContain('queres');
    expect(findVoseoOrRegional('tenés razón')).toContain('tenés');
    expect(findVoseoOrRegional('tenes razon')).toContain('tenes');
    expect(findVoseoOrRegional('podes revisar la teja')).toContain('podes');
    expect(findVoseoOrRegional('podés revisar la teja')).toContain('podés');
    expect(findVoseoOrRegional('sos el encargado')).toContain('sos');
    expect(findVoseoOrRegional('hacé la inspección')).toContain('hacé');
    expect(findVoseoOrRegional('decime el precio')).toContain('decime');
    expect(findVoseoOrRegional('vení mañana')).toContain('vení');
    expect(findVoseoOrRegional('mira el goterón')).toContain('mira');
  });
  it('detects the peninsular second person',()=>{
    expect(findVoseoOrRegional('vosotros habéis visto la obra')).toContain('vosotros');
    expect(findVoseoOrRegional('tenéis el presupuesto')).toContain('tenéis');
    expect(findVoseoOrRegional('podeis firmar aqui')).toContain('podeis');
  });
  it('does not fire on neutral Latin American Spanish',()=>{
    expect(findVoseoOrRegional('usted tiene el presupuesto y puede firmar aquí')).toEqual([]);
    expect(rulesOf([spanish({text:words('es',60)+' usted puede revisar el techo'})])).not.toContain('voseo');
  });
  it('reports spanish voseo through the script rule',()=>{
    expect(rulesOf([spanish({text:words('es',60)+' vos tenés el presupuesto'})])).toContain('voseo');
  });
  it('is not applied to english scripts',()=>{
    expect(rulesOf([script({text:words('en',55)+' vos tenes el presupuesto'})])).not.toContain('voseo');
  });
});

describe('regional vocabulary and currency',()=>{
  it('detects country-flavoured words',()=>{
    for(const word of ['chévere','chido','guay','bacán','bacan','pibe','che','ahorita'])expect(findVoseoOrRegional(`un techo ${word} de verdad`)).toContain(word);
    expect(findVoseoOrRegional('ya mismo paso por el techo')).toContain('ya mismo');
  });
  it('detects vale and padre only in their regional use',()=>{
    expect(findVoseoOrRegional('vale, paso mañana')).toContain('vale');
    expect(findVoseoOrRegional('queda muy padre')).toContain('padre');
    expect(findVoseoOrRegional('este material vale más que el otro')).not.toContain('vale');
    expect(findVoseoOrRegional('su padre trabaja en la obra')).not.toContain('padre');
  });
  it('rejects local currencies instead of US dollars',()=>{
    expect(rulesOf([spanish({text:words('es',50)+' cuesta dos mil pesos'})])).toContain('currency');
    expect(rulesOf([spanish({text:words('es',50)+' cuesta dos mil soles'})])).toContain('currency');
    expect(rulesOf([spanish({text:words('es',50)+' cuesta mil quetzales'})])).toContain('currency');
    expect(rulesOf([spanish({text:words('es',45)+' cuesta 1,200 dolares'})])).not.toContain('currency');
  });
  it('reports regional vocabulary through the script rule',()=>{
    expect(rulesOf([spanish({text:words('es',60)+' el techo quedo chido'})])).toContain('regionalism');
  });
});

describe('personal data and card-like numbers',()=>{
  it('detects e-mail, phone, URL, card and postal-code shapes',()=>{
    expect(findPersonalData('write to juan.perez@correo-falso.com')).not.toEqual([]);
    expect(findPersonalData('call 555-123-4567 today')).not.toEqual([]);
    expect(findPersonalData('see https://tejados-ejemplo.com for details')).not.toEqual([]);
    expect(findPersonalData('see tejados-ejemplo.com for details')).not.toEqual([]);
    expect(findPersonalData('card 4111 1111 1111 1111')).not.toEqual([]);
    expect(findPersonalData('mail to 12 Oak Street, Austin TX 78701')).not.toEqual([]);
    expect(findPersonalData('codigo postal 06010')).not.toEqual([]);
  });
  it('leaves decimals, percents, times and dollar amounts alone',()=>{
    expect(findPersonalData('3.5 percent, 15%, 7:45 a.m., $1,450, 12,500 square feet')).toEqual([]);
  });
  it('reports personal data through the script rule',()=>{
    expect(rulesOf([script({text:words('en',55)+' write to me at a.b@falso.com'})])).toContain('personal-data');
  });
});

describe('real brands',()=>{
  it('lists real technology and construction brands as forbidden',()=>{
    expect(findRealBrands('we use Home Depot lumber')).not.toEqual([]);
    expect(findRealBrands('the Apple phone and the Bosch drill')).not.toEqual([]);
  });
  it('does not fire on invented marks',()=>{
    expect(findRealBrands('Tejarrube sells the Cumbratel line and the Pluvionorte gutter')).toEqual([]);
  });
  it('reports a real brand through the script rule',()=>{
    expect(rulesOf([script({text:words('en',55)+' we buy at Lowes and at Home Depot'})])).toContain('brand');
  });
});

describe('numeric token extraction',()=>{
  it('keeps grouped and decimal numbers as one token',()=>{
    expect(numericTokens('total $1,450 and 3.5 and 12,500')).toEqual(['1,450','3.5','12,500']);
    expect(numericTokens('no digits here')).toEqual([]);
  });
});

describe('clock markers',()=>{
  it('flags the spaced a. m. and p. m. forms',()=>{
    expect(findSpacedClockMarkers('start at 7:30 a. m. sharp')).toContain('a. m.');
    expect(findSpacedClockMarkers('arrive at 2:15 p. m.')).toContain('p. m.');
  });
  it('accepts the closed forms',()=>{
    expect(findSpacedClockMarkers('start at 7:30 a.m. sharp')).toEqual([]);
    expect(findSpacedClockMarkers('arrive at 2:15 p.m.')).toEqual([]);
  });
  it('reports a spaced marker through the script rule, and only for English',()=>{
    expect(rulesOf([script({text:words('en',55)+' start at 7:30 a. m.'})])).toContain('clock-marker');
    expect(rulesOf([spanish({text:words('es',55)+' empieza a las 7:30 a. m.'})])).not.toContain('clock-marker');
  });
});

describe('UTF-8 text',()=>{
  it('accepts accented names inside an English script',()=>{
    expect(rulesOf([script({text:words('en',50)+' Andrés Peñalosa and Sofía Márquez signed'})])).toEqual([]);
  });
  it('accepts standard Spanish with tildes, enie and opening signs',()=>{
    expect(findEncodingDamage('¿Qué tal? ¡Mañana el niño de la señora Muñoz!')).toEqual([]);
    expect(rulesOf([spanish({text:words('es',20)+' ¿Qué día llega el dueño? ¡Mañana!'})])).not.toContain('encoding');
  });
  it('rejects mojibake and the replacement character',()=>{
    expect(findEncodingDamage('el niÃ±o')).not.toEqual([]);
    expect(findEncodingDamage('seÃ±ora')).not.toEqual([]);
    expect(findEncodingDamage('cuesta 12\u00C2\u00A0dólares')).not.toEqual([]);
    expect(findEncodingDamage('roof \uFFFD work')).not.toEqual([]);
    expect(findEncodingDamage('plain ASCII and real é and ñ')).toEqual([]);
  });
  it('reports encoding damage through the script rule',()=>{
    expect(rulesOf([spanish({text:words('es',55)+' el niÃ±o'})])).toContain('encoding');
  });
});

describe('reporting',()=>{
  it('never echoes a whole script in a violation message',()=>{
    const text=words('en',55)+' vos tenes el presupuesto y ademas cuesta dos mil pesos';
    const {violations}=validateScripts([spanish({text})],{requireFullSet:false});
    expect(violations.length).toBeGreaterThan(0);
    for(const violation of violations)expect(violation.message).not.toContain(text);
  });
  it('returns a per-language and per-kind tally',()=>{
    const report=validateScripts(fullSet(),{requireFullSet:true});
    expect(report.ok).toBe(true);
    expect(report.counts).toEqual({en:16,es:16});
    expect(report.kinds.en).toEqual({short:12,long:2,extended:1,negative_control:1});
  });
});
