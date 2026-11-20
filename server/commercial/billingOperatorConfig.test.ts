// LV-019.B piece D: configuration for the operator endpoint, read from the environment. Everything is fail-closed: a missing or
// malformed value switches the endpoint (or only its writes) off, and a report of what is missing never contains a value.
import {describe,expect,it} from 'vitest';
import {createRateLimiter,operatorConfigFromEnv} from './billingOperatorConfig';
import {stub} from './billingFirestoreStub';

const SECRET='config-secret-not-real-0123456789abcdef';
const GOOD:Record<string,string>={VISTAVO_OPERATOR_UIDS:'uid-owner, uid-second',VISTAVO_OPERATOR_SECRET:SECRET,VISTAVO_OPERATOR_REAUTH_SEC:'300',VISTAVO_OPERATOR_RATE_MAX:'5',VISTAVO_OPERATOR_RATE_WINDOW_SEC:'60'};
const deps=()=>{const s=stub({});return {db:s.db as never,root:s.root as never,verifier:{verifyIdToken:async()=>({uid:'x'})},now:()=>1_000,log:()=>undefined};};
const from=(env:Record<string,string|undefined>)=>operatorConfigFromEnv(env,deps());

describe('operatorConfigFromEnv',()=>{
  it('a complete environment enables reads and writes and keeps the operator list exact',()=>{
    const r=from(GOOD);
    expect(r.enabled).toBe(true);expect(r.writesEnabled).toBe(true);expect(r.missing).toEqual([]);
    expect([...r.config.operators].sort()).toEqual(['uid-owner','uid-second']);
    expect(r.config.secret).toBe(SECRET);expect(r.config.reauthWindowSec).toBe(300);expect(typeof r.config.limiter).toBe('function');
  });
  it('an empty environment is disabled and names every missing variable',()=>{
    const r=from({});
    expect(r.enabled).toBe(false);expect(r.writesEnabled).toBe(false);
    expect(r.missing.sort()).toEqual(['VISTAVO_OPERATOR_RATE_MAX','VISTAVO_OPERATOR_RATE_WINDOW_SEC','VISTAVO_OPERATOR_REAUTH_SEC','VISTAVO_OPERATOR_SECRET','VISTAVO_OPERATOR_UIDS']);
    expect(r.config.operators.size).toBe(0);
  });
  it.each([
    ['uid list missing',{VISTAVO_OPERATOR_UIDS:undefined},'VISTAVO_OPERATOR_UIDS'],
    ['uid list blank',{VISTAVO_OPERATOR_UIDS:'  ,  '},'VISTAVO_OPERATOR_UIDS'],
    ['empty entry in the middle',{VISTAVO_OPERATOR_UIDS:'uid-owner,,uid-second'},'VISTAVO_OPERATOR_UIDS'],
    ['trailing comma',{VISTAVO_OPERATOR_UIDS:'uid-owner,uid-second,'},'VISTAVO_OPERATOR_UIDS'],
    ['leading comma',{VISTAVO_OPERATOR_UIDS:',uid-owner'},'VISTAVO_OPERATOR_UIDS'],
    ['one malformed uid invalidates the whole list',{VISTAVO_OPERATOR_UIDS:'uid-owner,bad uid with spaces'},'VISTAVO_OPERATOR_UIDS'],
    ['uid too long',{VISTAVO_OPERATOR_UIDS:'u'.repeat(129)},'VISTAVO_OPERATOR_UIDS'],
    ['secret too short',{VISTAVO_OPERATOR_SECRET:'short-secret'},'VISTAVO_OPERATOR_SECRET'],
    ['secret missing',{VISTAVO_OPERATOR_SECRET:undefined},'VISTAVO_OPERATOR_SECRET'],
  ])('%s: the endpoint is off',(_n,over,name)=>{
    const r=from({...GOOD,...over});
    expect(r.enabled).toBe(false);expect(r.writesEnabled).toBe(false);expect(r.missing).toContain(name);
  });
  it.each([
    ['rate max missing','VISTAVO_OPERATOR_RATE_MAX',undefined],['rate max zero','VISTAVO_OPERATOR_RATE_MAX','0'],['rate max negative','VISTAVO_OPERATOR_RATE_MAX','-1'],['rate max fractional','VISTAVO_OPERATOR_RATE_MAX','2.5'],
    ['rate max exponent','VISTAVO_OPERATOR_RATE_MAX','1e3'],['rate max padded','VISTAVO_OPERATOR_RATE_MAX',' 5'],['rate max leading zero','VISTAVO_OPERATOR_RATE_MAX','05'],['rate max text','VISTAVO_OPERATOR_RATE_MAX','many'],
    ['rate window missing','VISTAVO_OPERATOR_RATE_WINDOW_SEC',undefined],['rate window zero','VISTAVO_OPERATOR_RATE_WINDOW_SEC','0'],
  ])('%s: no limiter, so the whole endpoint is off',(_n,name,value)=>{
    const r=from({...GOOD,[name]:value});
    expect(r.enabled).toBe(false);expect(r.config.limiter).toBeUndefined();expect(r.missing).toContain(name);
  });
  it.each([['missing',undefined],['zero','0'],['fractional','1.5'],['text','soon'],['exponent','3e2']])('reauthentication window %s: reads work, writes stay off',(_n,value)=>{
    const r=from({...GOOD,VISTAVO_OPERATOR_REAUTH_SEC:value});
    expect(r.enabled).toBe(true);expect(r.writesEnabled).toBe(false);expect(r.config.reauthWindowSec).toBeUndefined();expect(r.missing).toEqual(['VISTAVO_OPERATOR_REAUTH_SEC']);
  });
  it('the report of missing variables never carries a value',()=>{
    const r=from({VISTAVO_OPERATOR_UIDS:'bad uid LEAK-1',VISTAVO_OPERATOR_SECRET:'LEAK-2-short',VISTAVO_OPERATOR_REAUTH_SEC:'LEAK-3',VISTAVO_OPERATOR_RATE_MAX:'LEAK-4',VISTAVO_OPERATOR_RATE_WINDOW_SEC:'LEAK-5'});
    expect(JSON.stringify(r.missing)).not.toMatch(/LEAK/);
    expect(JSON.stringify(Object.keys(r))).not.toMatch(/LEAK/);
  });
  it('a missing verifier, clock or log from the caller keeps the endpoint off',()=>{
    const d=deps();
    expect(operatorConfigFromEnv(GOOD,{...d,verifier:undefined as never}).enabled).toBe(false);
    expect(operatorConfigFromEnv(GOOD,{...d,now:undefined as never}).enabled).toBe(false);
    expect(operatorConfigFromEnv(GOOD,{...d,log:undefined as never}).enabled).toBe(false);
  });
});

describe('createRateLimiter',()=>{
  const make=(max:number,windowMs:number)=>{let t=1_000_000;const limiter=createRateLimiter({max,windowMs,now:()=>t});return {limiter,at:(v:number)=>{t=v;}};};
  it('allows exactly `max` calls per window and then refuses until the window passes',()=>{
    const {limiter,at}=make(3,10_000);
    expect([limiter('a'),limiter('a'),limiter('a'),limiter('a')]).toEqual([true,true,true,false]);
    at(1_000_000+9_999);expect(limiter('a')).toBe(false);
    at(1_000_000+10_001);expect(limiter('a')).toBe(true);
  });
  it('is per key: one operator cannot exhaust another',()=>{
    const {limiter}=make(1,10_000);
    expect([limiter('a'),limiter('a'),limiter('b'),limiter('b')]).toEqual([true,false,true,false]);
  });
  it('a refused call is not counted, so it does not extend the block',()=>{
    const {limiter,at}=make(1,10_000);
    expect(limiter('a')).toBe(true);at(1_000_000+5_000);expect(limiter('a')).toBe(false);at(1_000_000+10_001);expect(limiter('a')).toBe(true);
  });
  it('fails closed on an invalid clock',()=>{
    let t:number=Number.NaN;const limiter=createRateLimiter({max:5,windowMs:1000,now:()=>t});
    expect(limiter('a')).toBe(false);t=1.5;expect(limiter('a')).toBe(false);t=-1;expect(limiter('a')).toBe(false);t=2_000_000;expect(limiter('a')).toBe(true);
  });
  it('fails closed when the clock throws',()=>{
    const limiter=createRateLimiter({max:5,windowMs:1000,now:()=>{throw new Error('clock down');}});
    expect(limiter('a')).toBe(false);
  });
  it('rejects nonsensical settings at construction',()=>{
    for(const bad of [{max:0,windowMs:1000},{max:-1,windowMs:1000},{max:1.5,windowMs:1000},{max:1,windowMs:0},{max:1,windowMs:Number.NaN},{max:Number.POSITIVE_INFINITY,windowMs:1000}])
      expect(()=>createRateLimiter({...bad,now:()=>1})).toThrow();
  });
  it('tracks no more distinct keys than the configured bound (fails closed for a new key, existing keys keep working)',()=>{
    let t=1_000_000;const limiter=createRateLimiter({max:5,windowMs:10_000,maxKeys:2,now:()=>t});
    expect([limiter('a'),limiter('b'),limiter('c')]).toEqual([true,true,false]);
    expect(limiter.size()).toBe(2);expect(limiter('a')).toBe(true);
    t=1_000_000+10_001; // everything expired: a slot is free again
    expect(limiter('c')).toBe(true);
  });
  it('the bound derived from the configuration is the number of operators',()=>{
    const r=operatorConfigFromEnv({...GOOD,VISTAVO_OPERATOR_RATE_MAX:'50'},deps());
    const limiter=r.config.limiter as ((k:string)=>boolean);
    expect([limiter('op-1'),limiter('op-2'),limiter('op-3')]).toEqual([true,true,false]); // GOOD lists two operators
  });
  it('rejects a nonsensical key bound at construction',()=>{
    for(const maxKeys of [0,-1,1.5,Number.NaN])expect(()=>createRateLimiter({max:1,windowMs:1000,maxKeys,now:()=>1})).toThrow();
  });
  it('forgets idle keys so memory stays bounded',()=>{
    const {limiter,at}=make(1,1_000);
    for(let i=0;i<50;i++)limiter('k'+i);
    at(1_000_000+5_000);limiter('fresh');
    expect(limiter.size()).toBe(1);
  });
});
