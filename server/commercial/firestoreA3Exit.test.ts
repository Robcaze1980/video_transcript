// LV-019.B step 1.3a: the pure A-3 timeout boundary. Tests first: this file is red until the constant and the
// classifier exist. It deliberately checks only the clock/validation contract; the emulator file covers the
// transactional fence and real Account balance movement.
import {describe,expect,it} from 'vitest';
import * as firestoreBackend from './firestoreBackend';

const api=firestoreBackend as unknown as Record<string,unknown>;
const WINDOW=30*60*1000;
const SKEW=10*60*1000;
const NOW=1_000_000_000_000;
const classify=api.classifyA3ReplayWindow as
  ((intent:Record<string,unknown>,now:number,windowMs?:number,skewMs?:number)=>'due'|'wait'|'invalid')|undefined;

describe('A-3 replay window',()=>{
  it('exports a 30-minute replay window and the 10-minute clock-skew tolerance',()=>{
    expect(api.A3_REPLAY_WINDOW_MS).toBe(WINDOW);
    expect(api.A3_CLOCK_SKEW_MS).toBe(SKEW);
  });

  it('is due at the exact limit and waits one millisecond before it',()=>{
    expect(classify).toBeTypeOf('function');
    expect(classify!({createdAtMs:NOW-WINDOW},NOW)).toBe('due');
    expect(classify!({createdAtMs:NOW-WINDOW+1},NOW)).toBe('wait');
    expect(classify!({createdAtMs:NOW-WINDOW-1},NOW)).toBe('due');
  });

  it('rejects missing, non-integer, negative, and future timestamps beyond the skew',()=>{
    for(const bad of [undefined,null,'1000',1.5,Number.NaN,Number.POSITIVE_INFINITY,-1,NOW+SKEW+1]){
      expect(classify!({createdAtMs:bad},NOW),String(bad)).toBe('invalid');
    }
  });

  it('accepts a timestamp exactly at the tolerated future skew',()=>{
    expect(classify!({createdAtMs:NOW+SKEW},NOW)).toBe('wait');
  });

  it('uses the injected clock rather than wall time',()=>{
    const createdAtMs=NOW-WINDOW+1;
    expect(classify!({createdAtMs},NOW)).toBe('wait');
    expect(classify!({createdAtMs},NOW+1)).toBe('due');
  });
});
