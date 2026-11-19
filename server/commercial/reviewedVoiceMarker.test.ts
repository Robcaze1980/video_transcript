import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {createReviewedVoiceMarker,ReviewedVoiceMarkerFault,validateReviewedVoiceMarker,validateReviewedVoiceMarkerReplay} from './reviewedVoiceMarker';

const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const account='10000000-0000-4000-8000-000000000001',input='20000000-0000-4000-8000-000000000001';
const textJob='30000000-0000-4000-8000-000000000001',requestKey='synthetic-private-key-do-not-persist';
const female='narration:en:female',male='narration:en:male';
const secret='synthetic private sentence must not be serialized';

function binding(changes:Record<string,unknown>={}){
  const row:Record<string,any>={version:'reviewed-voice-binding-v1',identityKey:'a'.repeat(64),accountId:account,inputId:input,textJobId:textJob,
    revision:2,receiptId:'b'.repeat(64),bindingHash:'c'.repeat(64),payloadSha256:'d'.repeat(64),voiceTextSha256:'e'.repeat(64),
    inputGeneration:'9007199254740993',inputSha256:'f'.repeat(64),durationMs:2000,billableSeconds:3,versions:{synthetic:secret},...changes};
  if(!Object.hasOwn(changes,'reviewId'))row.reviewId=sha(['review-revision-v1',row.accountId,row.inputId,row.textJobId,row.revision]);
  Object.defineProperty(row,'canonicalEvidence',{value:{privateText:secret},enumerable:false,configurable:true,writable:true});
  return row;
}
const make=(overrides:Record<string,unknown>={},selected=female,key=requestKey)=>createReviewedVoiceMarker(binding(overrides),key,selected);
const rejected=(fn:()=>unknown)=>expect(fn).toThrow(ReviewedVoiceMarkerFault);

describe('disconnected reviewed voice marker codec',()=>{
  it('copies a verified-shape binding as immutable scalars, with 2,0004 source seconds represented by 3 billable seconds',()=>{
    const inputBinding=binding(),marker=createReviewedVoiceMarker(inputBinding,requestKey,female);
    expect(marker).toMatchObject({version:'reviewed-voice-marker-v1',bindingVersion:'reviewed-voice-binding-v1',canonVersion:'reviewed-voice-canon-v1',
      model:'gemini-3.8-flash-tts',accountId:account,inputId:input,textJobId:textJob,durationMs:2000,billableSeconds:3,operation:female,voiceId:'Kore'});
    expect(marker.markerId).toMatch(/^[a-f0-9]{64}$/);expect(marker.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(marker)).toBe(true);
    expect(marker.markerId).toBe(sha(['reviewed-voice-marker-id-v1',account,requestKey]));
    const json=JSON.stringify(marker);expect(json).not.toContain(secret);expect(json).not.toContain(requestKey);
    expect(json).not.toContain('canonicalEvidence');expect(json).not.toContain('versions');
    inputBinding.identityKey='0'.repeat(64);inputBinding.versions.synthetic='changed';inputBinding.canonicalEvidence.privateText='changed';
    expect(marker.identityKey).toBe('a'.repeat(64));expect(Reflect.set(marker,'billableSeconds',1)).toBe(false);
    expect(validateReviewedVoiceMarker(JSON.parse(json),account,requestKey,female)).toEqual(marker);
  });
  it('derives marker identity from the account and key, with voice inside the fingerprint',()=>{
    const first=make(),second=make({},male),differentKey=make({},female,requestKey+'-2');
    const otherAccount='10000000-0000-4000-8000-000000000002',differentAccount=make({accountId:otherAccount});
    expect(second.markerId).toBe(first.markerId);expect(second.fingerprint).not.toBe(first.fingerprint);expect(second.voiceId).toBe('Charon');
    expect(differentKey.markerId).not.toBe(first.markerId);expect(differentAccount.markerId).not.toBe(first.markerId);
    rejected(()=>validateReviewedVoiceMarker(first,account,requestKey,male));
    rejected(()=>validateReviewedVoiceMarker(first,account,requestKey+'-2',female));
    rejected(()=>validateReviewedVoiceMarker(first,otherAccount,requestKey,female));
  });
  it('uses explicit JSON array boundaries and a separate domain for the ID',()=>{
    const keys=['a:b','a|b','a","b','["a","b"]','a\\b','a"b','a b',' a b '];
    const ids=keys.map(key=>make({},female,key).markerId);expect(new Set(ids).size).toBe(keys.length);
    expect(ids[0]).not.toBe(sha([account,keys[0]]));
  });
  it.each([undefined,null,'','   ','x'.repeat(201),'line\nkey','bad\u0000key','\uD800'])('rejects an unsafe or invalid key without echoing it: %s',key=>{
    try{createReviewedVoiceMarker(binding(),key,female);expect.fail('Expected rejection');}catch(error){
      expect(error).toBeInstanceOf(ReviewedVoiceMarkerFault);expect(String(error)).not.toContain(secret);
      if(typeof key==='string'&&key.length>4)expect(String(error)).not.toContain(key);
    }
  });
  it('accepts a 200-character key and preserves distinct Unicode keys without silent normalization',()=>{
    expect(()=>make({},female,'x'.repeat(200))).not.toThrow();
    expect(make({},female,'é').markerId).not.toBe(make({},female,'e\u0301').markerId);
    expect(make({},female,' key ').markerId).not.toBe(make({},female,'key').markerId);
  });
  it.each([
    ['version','reviewed-voice-binding-v2'],['identityKey','A'.repeat(64)],['identityKey','a'.repeat(63)],['accountId','not-a-uuid'],
    ['inputId',{}],['textJobId','bad'],['revision',1],['revision',Number.MAX_SAFE_INTEGER+1],['reviewId','0'.repeat(64)],
    ['receiptId','b'.repeat(63)],['bindingHash','c'.repeat(63)],['payloadSha256','d'.repeat(63)],['voiceTextSha256','e'.repeat(63)],
    ['inputSha256','f'.repeat(63)],['inputGeneration','0'],['inputGeneration','01'],['inputGeneration','9'.repeat(32)],['inputGeneration',123],
    ['durationMs',0],['durationMs',600001],['durationMs',NaN],['durationMs',1.5],['billableSeconds',0],['billableSeconds',601],
    ['billableSeconds',Infinity],['billableSeconds','3'],['billableSeconds',1.5],
  ])('rejects an invalid binding field %s', (field,value)=>rejected(()=>make({[field]:value})));
  it('validates duration bounds without deriving seconds from truncated milliseconds',()=>{
    expect(make({durationMs:2000,billableSeconds:2}).billableSeconds).toBe(2);
    expect(make({durationMs:2000,billableSeconds:3}).billableSeconds).toBe(3);
    expect(make({durationMs:2001,billableSeconds:3}).billableSeconds).toBe(3);
    expect(make({durationMs:600000,billableSeconds:600}).billableSeconds).toBe(600);
    rejected(()=>make({durationMs:2001,billableSeconds:2}));rejected(()=>make({durationMs:2000,billableSeconds:4}));
  });
  it('rejects unsupported operations and inconsistent IDs',()=>{
    for(const value of ['translation:en','narration:en','narration:en:other','NARRATION:EN:MALE',null])rejected(()=>createReviewedVoiceMarker(binding(),requestKey,value));
    rejected(()=>make({reviewId:'0'.repeat(64)}));
  });
  it('rejects extra fields, symbols, getters and nonstandard prototypes without invoking private getters',()=>{
    const extra=binding();extra.extra='synthetic';rejected(()=>createReviewedVoiceMarker(extra,requestKey,female));
    const symbol:any=binding();symbol[Symbol('synthetic')]='x';rejected(()=>createReviewedVoiceMarker(symbol,requestKey,female));
    const accessor=binding();let called=false;Object.defineProperty(accessor,'canonicalEvidence',{get(){called=true;return secret;},configurable:true});
    rejected(()=>createReviewedVoiceMarker(accessor,requestKey,female));expect(called).toBe(false);
    const inherited=Object.assign(Object.create({synthetic:true}),binding());rejected(()=>createReviewedVoiceMarker(inherited,requestKey,female));
  });
  it('rejects every altered stored marker field, including structurally valid alternatives',()=>{
    const marker=make();
    for(const field of Object.keys(marker) as Array<keyof typeof marker>){
      const row:any={...marker},value=row[field];
      if(field==='operation')row[field]=male;
      else if(field==='voiceId')row[field]='Charon';
      else if(field==='billableSeconds')row[field]=2;
      else if(field==='durationMs')row[field]=2001;
      else if(field==='revision')row[field]=3;
      else if(field==='inputGeneration')row[field]='9007199254740994';
      else if(['accountId','inputId','textJobId'].includes(field))row[field]='40000000-0000-4000-8000-000000000001';
      else if(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))row[field]=value==='0'.repeat(64)?'1'.repeat(64):'0'.repeat(64);
      else row[field]=`${value}-changed`;
      rejected(()=>validateReviewedVoiceMarker(row,account,requestKey,female));
    }
  });
  it('rejects stored markers with missing, extra, accessor or symbol properties',()=>{
    const marker=make(),missing:any={...marker};delete missing.receiptId;rejected(()=>validateReviewedVoiceMarker(missing,account,requestKey,female));
    rejected(()=>validateReviewedVoiceMarker({...marker,extra:'x'},account,requestKey,female));
    const accessor:any={...marker};Object.defineProperty(accessor,'fingerprint',{get(){throw Error(secret);},enumerable:true});
    rejected(()=>validateReviewedVoiceMarker(accessor,account,requestKey,female));
    const symbol:any={...marker};symbol[Symbol('x')]=1;rejected(()=>validateReviewedVoiceMarker(symbol,account,requestKey,female));
  });
  it('does not treat a self-consistent fabricated binding as proof of identity or capture',()=>{
    // All hashes here are synthetic and no database/token is consulted. A
    // structurally coherent marker can be fabricated; a caller must still
    // authenticate and read the binding inside the eventual write transaction.
    const fake=make({identityKey:'9'.repeat(64),bindingHash:'8'.repeat(64)});
    expect(validateReviewedVoiceMarker(fake,account,requestKey,female)).toEqual(fake);
  });
});

describe('reviewed voice marker replay against a current binding',()=>{
  it.each([female,male])('accepts an identical current binding for %s without exposing private text or the key',selected=>{
    const original=make({},selected),stored=JSON.parse(JSON.stringify(original));
    const replay=validateReviewedVoiceMarkerReplay(stored,binding(),account,requestKey,selected);
    expect(replay).toEqual(original);expect(Object.isFrozen(replay)).toBe(true);
    expect(JSON.stringify(replay)).not.toContain(secret);expect(JSON.stringify(replay)).not.toContain(requestKey);
  });
  it.each([
    ['identityKey','0'.repeat(64)],['accountId','40000000-0000-4000-8000-000000000001'],
    ['inputId','40000000-0000-4000-8000-000000000002'],['textJobId','40000000-0000-4000-8000-000000000003'],
    ['revision',3],['receiptId','0'.repeat(64)],['bindingHash','0'.repeat(64)],['payloadSha256','0'.repeat(64)],
    ['voiceTextSha256','0'.repeat(64)],['inputGeneration','9007199254740994'],['inputSha256','0'.repeat(64)],
    ['durationMs',2001],['billableSeconds',2],
  ])('rejects a structurally valid current binding with changed %s under the same key', (field,value)=>{
    const stored=make(),changed=binding({[field]:value});
    expect(()=>createReviewedVoiceMarker(changed,requestKey,female)).not.toThrow();
    expect(validateReviewedVoiceMarker(stored,account,requestKey,female)).toEqual(stored);
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,changed,account,requestKey,female));
  });
  it('rejects mismatched operation, key, account and independently coherent fabricated marker',()=>{
    const stored=make(),fabricated=make({identityKey:'9'.repeat(64),bindingHash:'8'.repeat(64)});
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding(),account,requestKey,male));
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding(),account,requestKey+'-2',female));
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding(),'40000000-0000-4000-8000-000000000001',requestKey,female));
    expect(validateReviewedVoiceMarker(fabricated,account,requestKey,female)).toEqual(fabricated);
    rejected(()=>validateReviewedVoiceMarkerReplay(fabricated,binding(),account,requestKey,female));
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding({reviewId:'0'.repeat(64)}),account,requestKey,female));
  });
  it('preserves case and Unicode distinctions in identifiers and request keys',()=>{
    const lower='abcdefab-cdef-4000-8000-abcdefabcdef',upper=lower.toUpperCase(),base=binding({accountId:lower});
    const marker=createReviewedVoiceMarker(base,'Key-é',female);
    expect(validateReviewedVoiceMarkerReplay(marker,binding({accountId:lower}),lower,'Key-é',female)).toEqual(marker);
    rejected(()=>validateReviewedVoiceMarkerReplay(marker,binding({accountId:upper}),lower,'Key-é',female));
    rejected(()=>validateReviewedVoiceMarkerReplay(marker,binding({accountId:lower}),lower,'key-é',female));
    rejected(()=>validateReviewedVoiceMarkerReplay(marker,binding({accountId:lower}),lower,'Key-e\u0301',female));
  });
  it('rejects invalid limits and private accessors without reading them',()=>{
    const stored=make(),accessor=binding(),versionAccessor=binding();let called=false;
    Object.defineProperty(accessor,'canonicalEvidence',{get(){called=true;return secret;},configurable:true});
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,accessor,account,requestKey,female));expect(called).toBe(false);
    Object.defineProperty(versionAccessor,'versions',{get(){called=true;return {};},configurable:true});
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,versionAccessor,account,requestKey,female));expect(called).toBe(false);
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding({durationMs:600000,billableSeconds:601}),account,requestKey,female));
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding({durationMs:601000,billableSeconds:601}),account,requestKey,female));
  });
  it('does not claim to detect document-version changes or content changed and restored',()=>{
    const first=binding(),stored=createReviewedVoiceMarker(first,requestKey,female),later=binding();
    rejected(()=>validateReviewedVoiceMarkerReplay(stored,binding({payloadSha256:'0'.repeat(64)}),account,requestKey,female));
    later.versions={synthetic:'a new document version'};
    later.canonicalEvidence.privateText='a different in-memory object with the same supplied hashes';
    // Only scalar content in the binding is compared. A durable version/history
    // witness and independent binding validation remain a separate requirement.
    // Once changed hashes are restored, the intervening change is invisible.
    expect(validateReviewedVoiceMarkerReplay(stored,later,account,requestKey,female)).toEqual(stored);
  });
});
