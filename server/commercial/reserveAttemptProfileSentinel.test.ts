// LV-019.B step 1.3b sentinel: the persisted attempt profile is the historical
// v1 literal. If the live AI catalog changes, this test must fail until an
// explicit evidence migration is decided; runtime code stays decoupled.
import {describe,expect,it} from 'vitest';
import {AI_CATALOG_VERSION} from './aiContracts';
import {RESERVE_ATTEMPT_PROFILE_V1} from './reserveAttemptEvidence';

describe('reserve attempt profile',()=>{
  it('persists the historical ai-candidate-v1 profile',()=>{
    expect(RESERVE_ATTEMPT_PROFILE_V1).toBe('ai-candidate-v1');
  });

  it('fails if the live catalog moved without an explicit evidence migration',()=>{
    expect(AI_CATALOG_VERSION).toBe(RESERVE_ATTEMPT_PROFILE_V1);
  });
});
