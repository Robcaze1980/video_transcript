// LV-019.B phase 1 (plan step 1.2, second part): the pure core of the UNKNOWN resolver, checked WITHOUT an emulator.
// Tests first: they pin the contract (the two exported window/skew constants, the pure classification of
// `quarantinedAtMs`/`unknownAttemptId`, the evidence string and its SHA-256, and the argument validation of
// `resolveExpiredUnknown`) before any of it exists. Everything asserted here is absent today, so this file is red now:
// the constants, the classifier, the evidence builder and the method itself.
// Design: docs/specs/LV-019-B-cancelacion-y-unknown-diseno.md (sections 3 and 4).
import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import * as firestoreBackend from './firestoreBackend';
import {UNKNOWN_RESOLUTION_MIN_AGE_MS} from '../account/settlementContract';

const WINDOW=6*60*60*1000;
const SKEW=10*60*1000;
const NOW=1_000_000_000_000;
const JOB='20000000-0000-4000-8000-000000000001';
const ATTEMPT='30000000-0000-4000-8000-000000000002';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');

// The pure surface this step adds. It does not exist yet, so it is reached through the module namespace (a named import
// of a missing export would fail to link the whole file) and reads as `undefined` today.
type Verdict={state:'not_due'}|{state:'invalid';field:'quarantinedAtMs'|'unknownAttemptId'}|{state:'expired';evidence:string;evidenceSha256:string};
const api=firestoreBackend as unknown as Record<string,unknown>;
const classify=api.classifyUnknownQuarantine as
  (row:{quarantinedAtMs?:unknown;unknownAttemptId?:unknown},options:{jobId:string;admitted:boolean;now:number;windowMs?:number;skewMs?:number})=>Verdict;
const evidenceOf=api.unknownExpiredEvidence as (jobId:string,unknownAttemptId:string|null,quarantinedAtMs:number)=>string;
const evidence=(attempt:string|'none',quarantinedAtMs:number)=>`unknown_expired:v1:${JOB}:${attempt}:${quarantinedAtMs}`;
// The pure classifier raises when a test-only override is out of its bounds (the simplest, most conservative reading of
// invalid override): a caller must never be able to buy a longer window or a wider skew with a bad number.
const expectInvalid=(overrides:{windowMs?:unknown;skewMs?:unknown})=>{
  let thrown:unknown=null;
  try{classify({quarantinedAtMs:NOW,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,...overrides} as never);}
  catch(error){thrown=error;}
  expect(thrown).toMatchObject({code:'invalid'});
};

describe('the UNKNOWN review window and clock skew constants',()=>{
  it('declares a six-hour window above the Account floor and a ten-minute tolerated future skew',()=>{
    expect(api.UNKNOWN_REVIEW_WINDOW_MS).toBe(WINDOW);
    expect(api.UNKNOWN_CLOCK_SKEW_MS).toBe(SKEW);
    // The window must exceed the Account floor, otherwise every release would be refused as too_early.
    expect(api.UNKNOWN_REVIEW_WINDOW_MS as number).toBeGreaterThan(UNKNOWN_RESOLUTION_MIN_AGE_MS);
  });
});

describe('the evidence string of an expired unknown',()=>{
  it('echoes the job, the admitted attempt and the quarantine instant, hashed over the raw bytes',()=>{
    expect(evidenceOf(JOB,ATTEMPT,NOW-1)).toBe(evidence(ATTEMPT,NOW-1));
    expect(sha(evidence(ATTEMPT,NOW-1))).toMatch(/^[a-f0-9]{64}$/);
  });
  it('uses the literal none when there is no admitted attempt',()=>{
    expect(evidenceOf(JOB,null,NOW-2)).toBe(evidence('none',NOW-2));
  });
});

describe('classifying one unknown row before the resolver decides its due date',()=>{
  it('is not due while the window is still open, including one millisecond before the limit',()=>{
    expect(classify({quarantinedAtMs:NOW-WINDOW+1,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW})).toEqual({state:'not_due'});
  });
  it('is due exactly at the limit and one millisecond later, and the evidence carries the quarantine instant',()=>{
    expect(classify({quarantinedAtMs:NOW-WINDOW,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW}))
      .toEqual({state:'expired',evidence:evidence(ATTEMPT,NOW-WINDOW),evidenceSha256:sha(evidence(ATTEMPT,NOW-WINDOW))});
    expect(classify({quarantinedAtMs:NOW-WINDOW-1,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW}).state).toBe('expired');
    expect(classify({quarantinedAtMs:NOW-WINDOW+1,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW}).state).toBe('not_due');
  });
  it('counts a corrupt quarantinedAtMs as invalid, never as a silent not-due',()=>{
    for(const bad of [undefined,null,'1000',true,[],{},-1,-0.5,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+2])
      expect(classify({quarantinedAtMs:bad,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW}),String(bad)).toEqual({state:'invalid',field:'quarantinedAtMs'});
  });
  it('tolerates a quarantine in the near future only up to the injected skew',()=>{
    expect(classify({quarantinedAtMs:NOW+SKEW,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW}).state).toBe('not_due');
    expect(classify({quarantinedAtMs:NOW+SKEW+1,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW})).toEqual({state:'invalid',field:'quarantinedAtMs'});
    expect(classify({quarantinedAtMs:NOW+SKEW+1,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,skewMs:SKEW+1}).state).toBe('not_due');
  });
  it('requires a UUID attempt only when the row carries an admission',()=>{
    // The last case was a valid UUID once (`...0001`); a non-hex tail is what actually breaks the pattern.
    for(const bad of [undefined,null,'','not-a-uuid',ATTEMPT.slice(0,-1),ATTEMPT+'x',`${ATTEMPT.slice(0,-1)}z`])
      expect(classify({quarantinedAtMs:NOW-1,unknownAttemptId:bad},{jobId:JOB,admitted:true,now:NOW})).toEqual({state:'invalid',field:'unknownAttemptId'});
    // Without an admission the attempt is not used by the release, so its absence is fine and the evidence says none.
    // The quarantine must still be past the window for the row to be due, so use the exact limit, not `now - 1`.
    expect(classify({quarantinedAtMs:NOW-WINDOW},{jobId:JOB,admitted:false,now:NOW}))
      .toEqual({state:'expired',evidence:evidence('none',NOW-WINDOW),evidenceSha256:sha(evidence('none',NOW-WINDOW))});
    // A dangling non-UUID attempt without an admission is not an error either: it is simply not the claim.
    expect(classify({quarantinedAtMs:NOW-WINDOW,unknownAttemptId:'nope'},{jobId:JOB,admitted:false,now:NOW}).state).toBe('expired');
  });
  it('accepts a test-only window override so a scenario can expire a row on demand',()=>{
    expect(classify({quarantinedAtMs:NOW-1_000,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,windowMs:1_000}).state).toBe('expired');
    expect(classify({quarantinedAtMs:NOW-1_000,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,windowMs:1_001}).state).toBe('not_due');
  });
  it('refuses a window override that is not a safe integer in [1000, six hours]',()=>{
    // The override may only SHORTEN the six-hour window; a value outside the bounds (or not a number) is refused, never
    // silently honored, so a fixture cannot buy a longer wait with a bad parameter.
    for(const windowMs of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,0,-1,1.5,999,WINDOW+1,'1000',null,true,{}])
      expectInvalid({windowMs});
    // The exact bounds are legal: one second at the floor, the full window at the ceiling.
    expect(classify({quarantinedAtMs:NOW-1_000,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,windowMs:1_000}).state).toBe('expired');
    expect(classify({quarantinedAtMs:NOW-WINDOW,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,windowMs:WINDOW}).state).toBe('expired');
    expect(classify({quarantinedAtMs:NOW-WINDOW+1,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,windowMs:WINDOW}).state).toBe('not_due');
  });
  it('refuses a skew override that is not a safe integer in [0, one hour]',()=>{
    for(const skewMs of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,-1,1.5,3_600_001,'0',null,true,[]])
      expectInvalid({skewMs});
    // Zero and the one-hour ceiling are legal.
    expect(classify({quarantinedAtMs:NOW,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,skewMs:0}).state).toBe('not_due');
    expect(classify({quarantinedAtMs:NOW+SKEW,unknownAttemptId:ATTEMPT},{jobId:JOB,admitted:true,now:NOW,skewMs:3_600_000}).state).toBe('not_due');
  });
});

describe('resolveExpiredUnknown argument validation',()=>{
  // A backend whose transaction runner must never be reached by a rejected argument: validation happens first.
  const inert=new firestoreBackend.FirestoreBackend({runTransaction(){throw Error('the database must not be touched');}} as never,{} as never);
  const call=(options:unknown)=>Promise.resolve((inert as unknown as {resolveExpiredUnknown:(options:unknown)=>Promise<unknown>}).resolveExpiredUnknown(options));
  it('is a method of FirestoreBackend',()=>{
    expect(typeof (inert as unknown as {resolveExpiredUnknown?:unknown}).resolveExpiredUnknown).toBe('function');
  });
  it('rejects a bad clock or limit before touching the database',async()=>{
    for(const now of [-1,1.5,NaN,'0',undefined,null])
      await expect(call({now,limit:5})).rejects.toMatchObject({code:'invalid'});
    for(const limit of [0,-1,1.5,101,NaN,undefined,null])
      await expect(call({now:NOW,limit})).rejects.toMatchObject({code:'invalid'});
  });
  it('rejects a cursor that is not a plain document id and accepts null as the documented reset',async()=>{
    // A Firestore-reserved id (`__...__`) is refused too: it could not be a legal cursor for a real `jobs` document.
    for(const after of ['','a/b','.','__reserved__','__proto__',123,false])
      await expect(call({now:NOW,limit:5,after})).rejects.toMatchObject({code:'invalid'});
    // A null cursor is the wrap; it must get past validation (it will then reach the inert runner and fail there).
    await expect(call({now:NOW,limit:5,after:null})).rejects.toThrow(/must not be touched/);
  });
  it('rejects a test-only window or skew override outside its bounds before touching the database',async()=>{
    // The window override may only shorten the interface; the skew stays within its ceiling. Everything else is invalid.
    for(const windowMs of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,0,-1,1.5,999,WINDOW+1,'1000',null,true,{}])
      await expect(call({now:NOW,limit:5,windowMs}),String(windowMs)).rejects.toMatchObject({code:'invalid'});
    for(const skewMs of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,-1,1.5,3_600_001,'0',null,true,[]])
      await expect(call({now:NOW,limit:5,skewMs}),String(skewMs)).rejects.toMatchObject({code:'invalid'});
    // The legal bounds get past validation and then reach the inert runner.
    await expect(call({now:NOW,limit:5,windowMs:1_000,skewMs:0})).rejects.toThrow(/must not be touched/);
    await expect(call({now:NOW,limit:5,windowMs:WINDOW,skewMs:3_600_000})).rejects.toThrow(/must not be touched/);
  });
});
