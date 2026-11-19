import {createHash, randomUUID} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {FirestoreAi} from './firestoreAi';
import {FirestoreBackend} from './firestoreBackend';
import {firestoreHttp} from './firestoreHttp';
import {privateBucket} from './privateObjectPlan';

// Deliberately small, sequential Firestore stand-in. It exercises the actual
// customer service, HTTP handler, and backend transaction logic, but does not
// model Firestore concurrency, retries, IAM, or remote billing.
class MemoryStore {
  rows = new Map<string, Record<string, any>>();
  ref(collection: string, id: string) { return {id, path: `${collection}/${id}`}; }
  snapshot(ref: {id: string; path: string}) {
    const current = this.rows.get(ref.path), data = current === undefined ? undefined : structuredClone(current);
    return {id:ref.id, ref, exists:data !== undefined, data:() => data, get:(key: string) => data?.[key]};
  }
  async runTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    const writes: Array<{kind:'create'|'update'; ref:{path:string}; value:Record<string,any>}> = [];
    const tx = {
      get: async (ref: any) => this.snapshot(ref),
      getAll: async (...refs: any[]) => refs.map(ref => this.snapshot(ref)),
      create: (ref: any, value: any) => writes.push({kind:'create', ref, value:structuredClone(value)}),
      update: (ref: any, value: any) => writes.push({kind:'update', ref, value:structuredClone(value)}),
    };
    const result = await work(tx), staged = new Map(this.rows);
    for (const write of writes) {
      const prior = staged.get(write.ref.path);
      if (write.kind === 'create') {
        if (prior !== undefined) throw Error('Synthetic duplicate create');
        staged.set(write.ref.path, write.value);
      } else {
        if (prior === undefined) throw Error('Synthetic missing update');
        staged.set(write.ref.path, {...prior, ...write.value});
      }
    }
    this.rows = staged;
    return result;
  }
}

class SyntheticResponse extends Writable {
  headers: Record<string,string> = {};
  statusCode = 200;
  parts: Buffer[] = [];
  setHeader(name:string, value:unknown) { this.headers[name.toLowerCase()] = String(value); return this; }
  writeHead(status:number, headers:Record<string,unknown> = {}) {
    this.statusCode=status;
    for (const [key,value] of Object.entries(headers)) this.setHeader(key,value);
    return this;
  }
  _write(chunk:Buffer, _encoding:BufferEncoding, callback:(error?:Error|null)=>void) { this.parts.push(Buffer.from(chunk)); callback(); }
  get body() { return Buffer.concat(this.parts); }
}

const sha = (value:string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const store = new MemoryStore(), account = randomUUID(), input = randomUUID(), uid = `synthetic-${randomUUID()}`;
  const root = {collection:(name:string) => ({doc:(id:string) => store.ref(name,id)})};
  const backend = new FirestoreBackend(store as never, root as never);
  const objectOperation = vi.fn(async () => { throw Error('Synthetic objects must not be contacted'); });
  const objects = new Proxy({}, {get:() => objectOperation});
  const ai = new FirestoreAi(store as never,root as never,backend,objects as never);
  const draft = 'Synthetic flat draft for a water pump.', inputSha = sha('synthetic video');
  store.rows.set(`identities/${sha(JSON.stringify(['firebase',uid]))}`, {uid,accountId:account});
  store.rows.set(`accounts/${account}`, {credited:10,available:10,reserved:0,consumed:0,active:0,aiPilot:true,simulationOnly:true});
  store.rows.set(`inputs/${input}`, {accountId:account,expiresAtMs:Date.now()+3600000,sha256:inputSha,deleted:false,ready:true,unknownCount:0,
    metadata:{duration:2,audioTracks:1},storage:{bucket:privateBucket,key:`candidate-files-v1/${input}/video.mp4`,generation:'1',size:100,sha256:inputSha}});
  // This old flat-draft marker deliberately has no structured review, receipt,
  // captured text job or evidence tying it to a completed translation.
  store.rows.set(`projects/${input}`, {accountId:account,inputId:input,revision:1,draft,updatedAtMs:1,
    reviewedTextRevision:1,reviewedTextSha256:sha(draft)});
  const verify = vi.fn(async (token:string,revoked?:boolean) => {
    expect(token).toBe('synthetic-token'); expect(revoked).toBe(true); return {uid,email_verified:true};
  });
  const handler = firestoreHttp({origin:'http://127.0.0.1',backend,ai,identity:{verifyIdToken:verify as never}});
  const state = () => {
    const balance = store.rows.get(`accounts/${account}`)!;
    const count = (name:string) => [...store.rows.keys()].filter(key => key.startsWith(name + '/')).length;
    return {available:balance.available,reserved:balance.reserved,active:balance.active,jobs:count('jobs'),requests:count('requests'),
      movements:count('movements'),outbox:count('outbox'),artifacts:count('artifacts'),reviews:count('reviewedTranslations'),
      receipts:count('reviewRequests'),calls:count('providerCalls')};
  };
  const call = async (method:string,path:string,data?:unknown) => {
    const bytes = data === undefined ? undefined : Buffer.from(JSON.stringify(data));
    const req:any = Readable.from(bytes ? [bytes] : []); req.url=path; req.method=method;
    req.headers={origin:'http://127.0.0.1',authorization:'Bearer synthetic-token',...(bytes?{'content-type':'application/json','content-length':String(bytes.length)}:{})};
    const res = new SyntheticResponse(); await handler(req,res as never); await finished(res);
    return {status:res.statusCode,body:JSON.parse(res.body.toString('utf8'))};
  };
  const request = (operation:string,key=randomUUID()) => call('POST','/api/cloud/ai/jobs',{inputId:input,operation,expectedRevision:1,requestKey:key});
  const quote = (operation:string) => call('GET',`/api/cloud/ai/quote?inputId=${input}&operation=${encodeURIComponent(operation)}&revision=1`);
  return {ai,backend,account,input,uid,state,request,quote,verify,objectOperation};
}

describe('customer voice remains disabled until structured provenance is integrated', () => {
  beforeEach(() => vi.stubGlobal('fetch',vi.fn(async () => { throw Error('Network must not be contacted'); })));
  afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

  it('keeps the independent text request available', async () => {
    const f=fixture(), response=await f.request('translation:en');
    expect(response.status).toBe(202); expect(response.body.id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(f.state()).toMatchObject({available:8,reserved:2,jobs:1,reviews:0,receipts:0,calls:0});
    expect(f.verify).toHaveBeenCalledTimes(1); expect(f.objectOperation).not.toHaveBeenCalled();
  });

  it('checks the UID instead of disclosing the gate to another identity', async () => {
    const f=fixture(), before=f.state(), other='synthetic-other-user';
    await expect(f.ai.quoteForUid(f.account,f.input,'narration:en:male',1,other)).rejects.toMatchObject({code:'not_found'});
    await expect(f.ai.enqueueForUid(f.account,f.input,'narration:en:male',1,randomUUID(),other)).rejects.toMatchObject({code:'not_found'});
    expect(f.state()).toEqual(before); expect(f.objectOperation).not.toHaveBeenCalled();
  });

  for (const operation of ['narration:en:female','narration:en:male'] as const) {
    it(`denies a ${operation} quote to the authorized customer`, async () => {
      const f=fixture(), before=f.state();
      await expect(f.ai.quoteForUid(f.account,f.input,operation,1,f.uid)).rejects.toMatchObject({code:'disabled'});
      expect(f.state()).toEqual(before); expect(f.objectOperation).not.toHaveBeenCalled();
    });

    it(`denies a ${operation} quote through HTTP`, async () => {
      const f=fixture(), before=f.state(), response=await f.quote(operation);
      expect(response).toEqual({status:503,body:{error:'disabled'}});
      expect(f.state()).toEqual(before); expect(f.verify).toHaveBeenCalledTimes(1);
      expect(f.objectOperation).not.toHaveBeenCalled();
    });

    it(`denies ${operation} in enqueueForUid without reserving`, async () => {
      const f=fixture(), before=f.state();
      await expect(f.ai.enqueueForUid(f.account,f.input,operation,1,randomUUID(),f.uid)).rejects.toMatchObject({code:'disabled'});
      expect(f.state()).toEqual(before); expect(f.objectOperation).not.toHaveBeenCalled();
    });

    it(`denies ${operation} through HTTP without reserving`, async () => {
      const f=fixture(), before=f.state(), response=await f.request(operation);
      expect(response).toEqual({status:503,body:{error:'disabled'}});
      expect(f.state()).toEqual(before); expect(f.verify).toHaveBeenCalledTimes(1);
      expect(f.objectOperation).not.toHaveBeenCalled();
    });

    it(`does not replay an older ${operation} job as a new admission`, async () => {
      const f=fixture(), key=randomUUID();
      // Seed a synthetic legacy job through the trusted internal transaction.
      // Status/authorized reads remain separate from enqueue admission.
      await f.backend.reserveSimulatedAiForUid(f.account,f.input,key,1,operation,1,f.uid);
      const before=f.state(); expect(before.jobs).toBe(1);
      await expect(f.ai.enqueueForUid(f.account,f.input,operation,1,key,f.uid)).rejects.toMatchObject({code:'disabled'});
      expect(f.state()).toEqual(before); expect(f.objectOperation).not.toHaveBeenCalled();
    });
  }
});
