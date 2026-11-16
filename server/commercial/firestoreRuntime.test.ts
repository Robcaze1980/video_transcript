import {afterEach,describe,expect,it,vi} from 'vitest';
import {firestoreRuntime} from './firestoreRuntime';

describe('hosted Firestore trust boundary',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  it('refuses a foreign project before initializing hosted services',()=>{
    expect(()=>firestoreRuntime('other-product' as never)).toThrow('Hosted runtime requires managed identity');
  });
  for(const project of ['vistavo-prod','linguistvision-dev'] as const) {
    for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS']) {
      it(`refuses inherited ${key} for ${project}`,()=>{
        for(const field of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS']) vi.stubEnv(field,undefined);
        vi.stubEnv(key,key==='GOOGLE_APPLICATION_CREDENTIALS'?'not-a-real-credential-file':'127.0.0.1:8185');
        expect(()=>firestoreRuntime(project)).toThrow('Hosted runtime requires managed identity');
      });
    }
  }
});
