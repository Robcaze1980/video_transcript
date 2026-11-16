import {afterEach,it,expect,vi} from 'vitest';
import {exerciseWorkerLifecycle} from './cloudLifecycleProbe';
afterEach(()=>vi.useRealTimers());
it('native probe harness holds readonly SDK read while actual worker completes fake business and coalesces the next tick',async()=>{
 vi.useFakeTimers();let reads=0,close=0,readSettled=false;const work=exerciseWorkerLifecycle({heartbeatRead:async before=>{await before();reads++;readSettled=true;return true;},close:async()=>{expect(readSettled).toBe(true);close++;}});
 await vi.advanceTimersByTimeAsync(4000);expect(reads).toBe(0);expect(close).toBe(0);
 await vi.advanceTimersByTimeAsync(4200);const result=await work;
 expect(result).toMatchObject({result:'PASS',heartbeatCalls:1,invokeCalls:1,uploadCalls:1,finishCalls:1,closeCalls:1,workerReturnedWhileHeartbeatHeld:false,realProviderRequests:0,gcsWrites:0,financialWrites:0});expect(reads).toBe(1);expect(close).toBe(1);
});
it('probe never claims PASS after readonly SDK failure and closes only after that operation settles',async()=>{
 vi.useFakeTimers();let settled=false,close=0;const work=exerciseWorkerLifecycle({heartbeatRead:async before=>{try{await before();throw Error('synthetic readonly failure');}finally{settled=true;}},close:async()=>{expect(settled).toBe(true);close++;}}),observed=work.then(()=>false,()=>true);
 await vi.advanceTimersByTimeAsync(8200);expect(await observed).toBe(true);expect(close).toBe(1);
});
