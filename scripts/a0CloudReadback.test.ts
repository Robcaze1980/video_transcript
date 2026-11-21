import {describe,expect,it} from 'vitest';
import {
  A0_PERMISSIONS,ALLOWED_HOSTS,PROJECT,TEST_IAM_BODY,
  assertUrl,assertRequest,redactText,sanitizeBindings,sanitizeAlertPolicy,
  summarizeQuotaInfos,runReadback,segment,journalPathFor,main,
} from './a0CloudReadback.mjs';

// The double is itself a guard: it refuses any request the script should never send, so a regression in the
// script fails here instead of silently passing.
type Call={url:string;method:string;body?:string;redirect?:string;headers:Record<string,string>};
type Route={status:number;body:any};
// A route body may be a factory, so a page walk can be driven without network.

const base=():Record<string,Route>=>({
  '/v1/projects/vistavo-prod:testIamPermissions':{status:200,body:{permissions:['datastore.indexes.create','datastore.indexes.list']}},
  '/v1/projects/vistavo-prod/services':{status:200,body:{services:[{config:{name:'run.googleapis.com'},state:'ENABLED'},{config:{name:'monitoring.googleapis.com'},state:'ENABLED'}]}},
  '/v2/projects/vistavo-prod/locations/us-central1/services':{status:200,body:{services:[{name:'projects/vistavo-prod/locations/us-central1/services/vistavo-files-api',ingress:'INGRESS_TRAFFIC_INTERNAL_ONLY',latestReadyRevision:'projects/vistavo-prod/locations/us-central1/services/vistavo-files-api/revisions/vistavo-files-api-00012-abc',template:{serviceAccount:'files@vistavo-prod.iam.gserviceaccount.com'}}]}},
  '/v2/projects/vistavo-prod/locations/us-central1/services/vistavo-files-api:getIamPolicy':{status:200,body:{bindings:[{role:'roles/run.invoker',members:['serviceAccount:scheduler@vistavo-prod.iam.gserviceaccount.com','user:ana@example.com','group:ops@example.com','allUsers']},{role:'roles/viewer',members:['user:ana@example.com']}]}},
  '/v1/projects/vistavo-prod/serviceAccounts':{status:200,body:{accounts:[{email:'files@vistavo-prod.iam.gserviceaccount.com',disabled:false},{email:'123456789-compute@developer.gserviceaccount.com',disabled:false}]}},
  '/v1/projects/vistavo-prod/locations/global/services/iam.googleapis.com/quotaInfos':{status:200,body:{quotaInfos:[{quotaId:'ServiceAccountCount',quotaDisplayName:'Service accounts',isPrecise:true,dimensionsInfos:[{details:{value:'100'}}]}]}},
  '/v3/projects/vistavo-prod/notificationChannels':{status:200,body:{notificationChannels:[{name:'projects/vistavo-prod/notificationChannels/123',type:'email',displayName:'Alertas de Ana <ana@example.com>',labels:{email_address:'ana@example.com'},enabled:true,verificationStatus:'VERIFIED'}]}},
  '/v3/projects/vistavo-prod/alertPolicies':{status:200,body:{alertPolicies:[{name:'projects/vistavo-prod/alertPolicies/456',displayName:'billing hold stuck (ana@example.com)',enabled:true,conditions:[{},{}]}]}},
  '/v2/projects/vistavo-prod/metrics':{status:200,body:{metrics:[{name:'projects/vistavo-prod/metrics/billing_hold_stuck',metricDescriptor:{type:'logging.googleapis.com/user/billing_hold_stuck'}}]}},
  '/v1/projects/vistavo-prod/locations/us-central1/jobs':{status:200,body:{jobs:[{name:'projects/vistavo-prod/locations/us-central1/jobs/vistavo-files-maintenance',state:'ENABLED',schedule:'*/5 * * * *',timeZone:'UTC',httpMethod:'POST',httpTarget:{httpMethod:'POST',uri:'https://vistavo-files-maintenance-abc.a.run.app/internal/maintenance?token=MUST-NOT-LEAK',oidcToken:{serviceAccountEmail:'scheduler@vistavo-prod.iam.gserviceaccount.com'}}}]}},
});

const CONTENT_HEADERS=['content-type','content-length','content-encoding','transfer-encoding'];
const headerNames=(headers:Record<string,string>)=>Object.keys(headers??{}).map(name=>name.toLowerCase()).sort();
// The transport contract: credentials on every request, a JSON content type only where a body is sent.
function assertTransportContract(method:string,body:unknown,headers:Record<string,string>){
  const names=headerNames(headers);
  const lower:Record<string,string>={};
  for(const [name,value] of Object.entries(headers??{}))lower[name.toLowerCase()]=value;
  if(lower.authorization!=='Bearer test-token-DO-NOT-LEAK')throw new Error('test double: missing or wrong authorization header');
  if(lower['x-goog-user-project']!=='vistavo-prod')throw new Error('test double: missing x-goog-user-project');
  const content=names.filter(name=>CONTENT_HEADERS.includes(name));
  if(method==='POST'){
    if(body===undefined)throw new Error('test double: POST without body');
    if(content.join(',')!=='content-type')throw new Error('test double: POST must carry exactly one content header, got ['+content.join(',')+']');
    if(lower['content-type']!=='application/json')throw new Error('test double: POST content-type must be application/json, got '+lower['content-type']);
  }else{
    if(body!==undefined)throw new Error('test double: GET with body must never be sent');
    if(content.length>0)throw new Error('test double: GET must not carry content headers, got ['+content.join(',')+']');
  }
}

function makeFetch(routes:Record<string,Route>,calls:Call[]){
  return async(url:string,init:any)=>{
    const call:Call={url,method:init.method,body:init.body,redirect:init.redirect,headers:init.headers??{}};
    calls.push(call);
    if(init.redirect!=='error')throw new Error('test double: redirects must be refused');
    if(init.method!=='GET'&&init.method!=='POST')throw new Error('test double: method '+init.method+' must never be sent');
    assertTransportContract(init.method,init.body,init.headers);
    if(init.method==='POST'&&init.body!==TEST_IAM_BODY)throw new Error('test double: POST body is not the fixed permissions list');
    const parsed=new URL(url);
    if(parsed.protocol!=='https:')throw new Error('test double: non https request');
    if(!ALLOWED_HOSTS.includes(parsed.hostname))throw new Error('test double: foreign host '+parsed.hostname);
    if(!/^\/v[0-9]+\/projects\/vistavo-prod(?:[/:]|$)/.test(decodeURIComponent(parsed.pathname)))throw new Error('test double: foreign project path');
    const route=routes[decodeURIComponent(parsed.pathname)];
    if(!route)return{status:404,json:async()=>({error:{status:'NOT_FOUND'}})};
    const body=typeof route.body==='function'?route.body():route.body;
    return{status:route.status,json:async()=>structuredClone(body)};
  };
}
const TOKEN='test-token-DO-NOT-LEAK';
async function run(routes:Record<string,Route>=base()){
  const calls:Call[]=[];
  const out=await runReadback({fetchImpl:makeFetch(routes,calls) as any,getToken:async()=>TOKEN,now:()=>new Date('2026-11-20T12:00:00.000Z'),timeoutMs:5000});
  return{calls,...out};
}
// Runs a readback whose per-path responses come from a sequence, so a page walk can be exercised offline.
async function runSequenced(sequence:Record<string,Route[]>,fallback:Record<string,Route>=base()){
  const calls:Call[]=[];
  const pending:Record<string,Route[]>={};
  for(const [key,value] of Object.entries(sequence))pending[key]=[...value];
  const fetchImpl=async(url:string,init:any)=>{
    const parsed=new URL(url);
    calls.push({url,method:init.method,body:init.body,redirect:init.redirect,headers:init.headers??{}});
    if(init.redirect!=='error')throw new Error('test double: redirects must be refused');
    assertTransportContract(init.method,init.body,init.headers);
    const key=decodeURIComponent(parsed.pathname);
    const queued=pending[key]?.shift();
    const route=queued??fallback[key];
    if(!route)return{status:404,json:async()=>({error:{status:'NOT_FOUND'}})};
    const body=typeof route.body==='function'?route.body():route.body;
    return{status:route.status,json:async()=>structuredClone(body)};
  };
  const out=await runReadback({fetchImpl:fetchImpl as any,getToken:async()=>TOKEN,now:()=>new Date('2026-11-20T12:00:00.000Z'),timeoutMs:5000});
  return{calls,...out};
}
const stable=(value:any)=>{const{calls,...rest}=value;const{generatedAt,...result}=rest.result;return{...rest,result};};

describe('closed host and path list',()=>{
  it('accepts only the allowed hosts',()=>{
    for(const host of ALLOWED_HOSTS)expect(()=>assertUrl(`https://${host}/v1/projects/${PROJECT}`)).not.toThrow();
    for(const url of [
      'https://example.com/v1/projects/vistavo-prod',
      'https://run.googleapis.com.evil.test/v2/projects/vistavo-prod/locations/us-central1/services',
      'https://secretmanager.googleapis.com/v1/projects/vistavo-prod/secrets',
      'https://monitoring.googleapis.com.evil/v3/projects/vistavo-prod/alertPolicies',
      `http://run.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/services`,
    ])expect(()=>assertUrl(url)).toThrow(/host refused|only https/i);
  });
  it('accepts only paths whose project segment is exactly the project',()=>{
    expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/services`)).not.toThrow();
    expect(()=>assertUrl(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`)).not.toThrow();
    for(const url of [
      'https://run.googleapis.com/v2/projects/vistavo-prod-other/locations/us-central1/services',
      'https://cloudresourcemanager.googleapis.com/v1/projects/vistavo-prod-other:testIamPermissions',
      'https://iam.googleapis.com/v1/projects/vistavo-prodx/serviceAccounts',
      'https://iam.googleapis.com/v1/projects/other-project/serviceAccounts',
      'https://iam.googleapis.com/v1/projects',
    ])expect(()=>assertUrl(url)).toThrow(/foreign project/i);
  });
  it('refuses traversal and encoded separators',()=>{
    for(const url of [
      `https://run.googleapis.com/v2/projects/${PROJECT}/../other/locations`,
      `https://run.googleapis.com/v2/projects/${PROJECT}/%2e%2e/other`,
      `https://run.googleapis.com/v2/projects/${PROJECT}/%2E%2E/other`,
      `https://run.googleapis.com/v2/projects/${PROJECT}/x%2f..%2fother`,
      `https://run.googleapis.com/v2/projects/${PROJECT}/x%5c..%5cother`,
      `https://run.googleapis.com/v2/projects/${PROJECT}/x%25other`,
      `https://run.googleapis.com/v2/projects/${PROJECT}/x%3fother`,
    ])expect(()=>assertUrl(url)).toThrow(/non canonical|encoded|foreign project/i);
  });
  it('refuses a traversal even though the URL parser would normalize it',()=>{
    const traversal=`https://run.googleapis.com/v2/projects/${PROJECT}/../other/locations`;
    expect(new URL(traversal).pathname).toBe('/v2/projects/other/locations');
    expect(()=>assertUrl(traversal)).toThrow(/non canonical|foreign project/i);
    expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/a/../b`)).toThrow(/non canonical/i);
  });
  it('refuses credentials, fragments and unknown query parameters',()=>{
    expect(()=>assertUrl('https://user:pw@run.googleapis.com/v2/projects/vistavo-prod/locations')).toThrow(/credentials/i);
    expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/locations#x`)).toThrow(/fragment/i);
    for(const query of ['key=AIzaSECRET','alt=json','prettyPrint=false','fields=*','pageSize=1&pageSize=2','pageSize=0','pageSize=abc','filter=a%00b'])
      expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/locations?${query}`)).toThrow(/query/i);
  });
});

describe('header contract',()=>{
  it('sends application/json on the fixed POST and no content header on any GET',async()=>{
    const{calls}=await run();
    const posts=calls.filter(c=>c.method==='POST');
    const gets=calls.filter(c=>c.method==='GET');
    expect(posts.length).toBeGreaterThan(0);
    expect(gets.length).toBeGreaterThan(0);
    for(const call of posts){
      const lower=Object.fromEntries(Object.entries(call.headers).map(([k,v])=>[k.toLowerCase(),v]));
      expect(lower['content-type']).toBe('application/json');
      expect(Object.keys(lower).filter(k=>CONTENT_HEADERS.includes(k))).toEqual(['content-type']);
    }
    for(const call of gets){
      const names=Object.keys(call.headers).map(k=>k.toLowerCase());
      expect(names.filter(name=>CONTENT_HEADERS.includes(name))).toEqual([]);
      expect(call.body).toBeUndefined();
    }
    for(const call of calls){
      const lower=Object.fromEntries(Object.entries(call.headers).map(([k,v])=>[k.toLowerCase(),v]));
      expect(lower.authorization).toBe('Bearer '+TOKEN);
      expect(lower['x-goog-user-project']).toBe(PROJECT);
    }
  });
  it('keeps the token out of the journal and of every recorded header',async()=>{
    const{calls,journal,result}=await run();
    expect(JSON.stringify(journal)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    for(const call of calls)for(const [name,value] of Object.entries(call.headers))
      if(name.toLowerCase()!=='authorization')expect(String(value)).not.toContain(TOKEN);
    for(const entry of journal)expect(headerNames(entry as any)).toEqual(['host','method','path','status']);
  });
});

describe('hardening found by the independent reviews',()=>{
  it('refuses any non default port',()=>{
    for(const url of [
      `https://run.googleapis.com:8443/v2/projects/${PROJECT}/locations/us-central1/services`,
      `https://monitoring.googleapis.com:80/v3/projects/${PROJECT}/alertPolicies`,
      `https://iam.googleapis.com:8080/v1/projects/${PROJECT}/serviceAccounts`,
    ])expect(()=>assertUrl(url)).toThrow(/port/i);
    expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/locations`)).not.toThrow();
  });

  it('reports an unsafe Cloud Run name without aborting the read',()=>{
    for(const name of ['a%2F..%2Fb','','a/b','..','a b'])expect(()=>segment(name)).toThrow(/unsafe/i);
    expect(segment('vistavo-files-api')).toBe('vistavo-files-api');
    const routes=base();
    routes['/v2/projects/vistavo-prod/locations/us-central1/services']={status:200,body:{services:[
      {name:'projects/vistavo-prod/locations/us-central1/services/a%2F..%2Fb',ingress:'INGRESS_TRAFFIC_ALL'},
      {name:'projects/vistavo-prod/locations/us-central1/services/vistavo-files-api',ingress:'INGRESS_TRAFFIC_INTERNAL_ONLY',template:{serviceAccount:'files@vistavo-prod.iam.gserviceaccount.com'}},
    ]}};
    return run(routes).then(({calls,result})=>{
      expect(result.cloud_run_services.readable).toBe(true);
      expect(result.cloud_run_services.count).toBe(2);
      expect(result.cloud_run_services.services[0]).toMatchObject({name:null,error:'unsafe resource name'});
      expect(result.cloud_run_services.services[1].name).toBe('vistavo-files-api');
      const policyCalls=calls.map(c=>String(c.url)).filter(url=>url.includes(':getIamPolicy'));
      expect(policyCalls).toHaveLength(1);
      expect(policyCalls[0]).toContain('services/vistavo-files-api:getIamPolicy');
    });
  });

  it('redacts a person e-mail that appears in a scheduler target path',async()=>{
    const routes=base();
    routes['/v1/projects/vistavo-prod/locations/us-central1/jobs']={status:200,body:{jobs:[{
      name:'projects/vistavo-prod/locations/us-central1/jobs/vistavo-files-maintenance',
      state:'ENABLED',
      httpTarget:{httpMethod:'POST',uri:'https://vistavo-files.example.com/notify/ana@example.com?token=MUST-NOT-LEAK'},
    }]}};
    const{result}=await run(routes);
    expect(result.scheduler.jobs[0].target.path).toBe('/notify/<email redacted>');
    expect(JSON.stringify(result)).not.toContain('ana@example.com');
    expect(JSON.stringify(result)).not.toContain('MUST-NOT-LEAK');
  });
  it('never copies an error object into the output',async()=>{
    for(const nasty of [{evil:'ana@example.com'},['PERMISSION_DENIED'],'PERMISSION_DENIED ana@example.com',42]){
      const routes:Record<string,Route>={};
      for(const key of Object.keys(base()))routes[key]={status:500,body:{error:{status:nasty}}};
      const{result}=await run(routes);
      const seen=JSON.stringify(result);
      expect(seen).not.toContain('ana@example.com');
      expect(seen).not.toContain('evil');
      expect(seen).not.toContain('PERMISSION_DENIED');
      expect(result.identity_permissions).toMatchObject({readable:false,httpStatus:500,error:'unknown'});
    }
  });

  it('keeps a known error string when the API reports one',async()=>{
    const routes:Record<string,Route>={};
    for(const key of Object.keys(base()))routes[key]={status:503,body:{error:{status:'UNAVAILABLE'}}};
    const{result}=await run(routes);
    expect(result.identity_permissions).toMatchObject({readable:false,httpStatus:503,error:'UNAVAILABLE'});
    expect(result.enabled_apis).toMatchObject({readable:false,httpStatus:503,error:'UNAVAILABLE'});
  });
});

describe('failed responses',()=>{
  it('treats a 200 permissions probe with a non array body as unrecognised',async()=>{
    const routes=base();
    routes['/v1/projects/vistavo-prod:testIamPermissions']={status:200,body:{permissions:'datastore.indexes.create'}};
    const{result}=await run(routes);
    expect(result.identity_permissions.readable).toBe(false);
    expect(result.identity_permissions.error).toBe('unrecognized response shape');
  });
  it('records a 500 on the probe without throwing',async()=>{
    const routes=base();
    routes['/v1/projects/vistavo-prod:testIamPermissions']={status:500,body:{error:{status:'INTERNAL'}}};
    const{result}=await run(routes);
    expect(result.identity_permissions).toMatchObject({readable:false,httpStatus:500,error:'INTERNAL'});
    expect(result.enabled_apis.readable).toBe(true);
  });
  it('records a 500 on a GET without throwing',async()=>{
    const routes=base();
    routes['/v3/projects/vistavo-prod/alertPolicies']={status:500,body:{error:{status:'INTERNAL'}}};
    const{result}=await run(routes);
    expect(result.monitoring.alertPolicies).toMatchObject({readable:false,httpStatus:500,error:'INTERNAL'});
    expect(result.monitoring.notificationChannels.readable).toBe(true);
  });
  it('reports a non 200 in the middle of a page walk as partial',async()=>{
    const path='/v1/projects/vistavo-prod/locations/us-central1/jobs';
    const{calls,result}=await runSequenced({[path]:[
      {status:200,body:{jobs:[{name:'projects/vistavo-prod/locations/us-central1/jobs/first',state:'ENABLED'}],nextPageToken:'page-2'}},
      {status:503,body:{error:{status:'UNAVAILABLE'}}},
    ]});
    expect(calls.filter(c=>decodeURIComponent(new URL(c.url).pathname)===path)).toHaveLength(2);
    expect(result.scheduler).toMatchObject({readable:false,httpStatus:503,error:'UNAVAILABLE',partialRows:1});
  });
});

describe('main: journal path and partial journal',()=>{
  const files=()=>{
    const written:Record<string,string>={};
    return{written,writeFile:(target:string,content:string)=>{written[target]=content;}};
  };
  it('derives a journal path from a .json output and refuses anything else',()=>{
    expect(journalPathFor('out.json')).toBe('out.journal.json');
    expect(journalPathFor('dir/out.json')).toBe('dir/out.journal.json');
    for(const name of ['a.json','dir/b.json','out.json','x.journal.json.json'])
      expect(journalPathFor(name)).not.toBe(name);
    for(const bad of ['out.txt','out','out.json.txt','.json'])expect(()=>journalPathFor(bad)).toThrow(/json/i);
    expect(()=>journalPathFor('run.journal.json')).toThrow(/journal/i);
  });
  it('writes result and journal on success',async()=>{
    const{written,writeFile}=files();
    const out=await main({outputPath:'result.json',fetchImpl:makeFetch(base(),[]) as any,getToken:async()=>TOKEN,now:()=>new Date('2026-11-20T12:00:00.000Z'),writeFile:writeFile as any,log:()=>undefined});
    expect(out.ok).toBe(true);
    expect(Object.keys(written).sort()).toEqual(['result.journal.json','result.json']);
    expect(JSON.parse(written['result.json']).project).toBe(PROJECT);
    expect(JSON.parse(written['result.journal.json']).requests.length).toBeGreaterThan(0);
  });
  it('still writes the partial journal when the transport fails',async()=>{
    const{written,writeFile}=files();
    const boom=async()=>{const error:any=new Error('boom');error.journal=[{host:'cloudresourcemanager.googleapis.com',method:'POST',path:`/v1/projects/${PROJECT}:testIamPermissions`,status:null,outcome:'refused'}];throw error;};
    const result=await main({outputPath:'result.json',fetchImpl:boom as any,getToken:async()=>TOKEN,writeFile:writeFile as any,log:()=>undefined}).then(()=>({ok:true}),error=>({ok:false,error}));
    expect(result.ok).toBe(false);
    expect(written['result.json']).toBeUndefined();
    const journal=JSON.parse(written['result.journal.json']);
    expect(journal.requests).toHaveLength(1);
    expect(journal.requests[0]).toMatchObject({status:null,outcome:'refused'});
    expect(written['result.journal.json']).not.toContain(TOKEN);
  });
  it('writes the partial journal when the token source refuses',async()=>{
    const{written,writeFile}=files();
    const badFetch=async()=>({status:200,json:async()=>({})});    const result=await main({outputPath:'result.json',fetchImpl:badFetch as any,getToken:async()=>{throw new Error('token refused');},writeFile:writeFile as any,log:()=>undefined}).then(()=>({ok:true}),error=>({ok:false,error}));
    expect(result.ok).toBe(false);
    expect(written['result.journal.json']).toBeDefined();
    expect(JSON.parse(written['result.journal.json']).requests).toEqual([]);
  });
});

describe('pagination',()=>{
  it('accepts opaque page tokens that a base64 page token produces',()=>{
    const token='AA+/==';
    expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/locations?pageToken=${encodeURIComponent(token)}`)).not.toThrow();
    for(const refused of ['a b','a\tb','a\u0000b','x'.repeat(4097)])
      expect(()=>assertUrl(`https://run.googleapis.com/v2/projects/${PROJECT}/locations?pageToken=${encodeURIComponent(refused)}`)).toThrow(/query/i);
  });
  it('follows a page token that contains characters outside base64url',async()=>{
    const path='/v1/projects/vistavo-prod/services';
    const{calls,result}=await runSequenced({[path]:[
      {status:200,body:{services:[{config:{name:'run.googleapis.com'}}],nextPageToken:'AA+/=='}},
      {status:200,body:{services:[{config:{name:'monitoring.googleapis.com'}}]}},
    ]});
    expect(calls.filter(c=>decodeURIComponent(new URL(c.url).pathname)===path)).toHaveLength(2);
    expect(result.enabled_apis.names).toEqual(['monitoring.googleapis.com','run.googleapis.com']);
    expect(result.enabled_apis).not.toHaveProperty('truncated');
  });
  it('reports a list cut by the page cap instead of passing it off as complete',async()=>{
    const path='/v1/projects/vistavo-prod/services';
    // The factory always answers with another page, so the walk can only stop at the cap.
    const routes={...base(),[path]:{status:200,body:()=>({services:[{config:{name:'run.googleapis.com'}}],nextPageToken:'next'})}};
    const{result}=await runSequenced({},routes);
    expect(result.enabled_apis.readable).toBe(true);
    expect(result.enabled_apis.truncated).toBe(true);
    expect(result.limits.truncatedSections).toContain(path);
    expect(result.limits.truncatedLists).toMatch(/not complete|partial|lower bound/i);
  });
});

describe('request shape: GET only, one fixed POST',()=>{
  const iam=`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`;
  const runUrl=`https://run.googleapis.com/v2/projects/${PROJECT}/locations/us-central1/services`;
  it('refuses any method other than GET except the permissions probe',()=>{
    expect(assertRequest({method:'GET',url:runUrl})).toBe('GET');
    for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])
      expect(()=>assertRequest({method,url:runUrl,body:method==='POST'?TEST_IAM_BODY:undefined})).toThrow(/method refused|POST refused/i);
    expect(()=>assertRequest({method:'GET',url:runUrl,body:'{}'})).toThrow(/GET with body/i);
    expect(()=>assertRequest({method:'POST',url:`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts`,body:TEST_IAM_BODY})).toThrow(/POST refused/i);
    expect(()=>assertRequest({method:'POST',url:iam+'?pageSize=5',body:TEST_IAM_BODY})).toThrow(/POST refused/i);
  });
  it('accepts only the exact fixed permissions body',()=>{
    expect(assertRequest({method:'POST',url:iam,body:TEST_IAM_BODY})).toBe('POST');
    const reordered=JSON.stringify({permissions:[...A0_PERMISSIONS].reverse()});
    const extra=JSON.stringify({permissions:A0_PERMISSIONS,extra:true});
    const subset=JSON.stringify({permissions:A0_PERMISSIONS.slice(0,13)});
    const added=JSON.stringify({permissions:[...A0_PERMISSIONS,'run.services.get']});
    for(const body of [reordered,extra,subset,added,'',undefined,{permissions:A0_PERMISSIONS} as any])
      expect(()=>assertRequest({method:'POST',url:iam,body})).toThrow(/body refused/i);
    expect(new Set(A0_PERMISSIONS).size).toBe(A0_PERMISSIONS.length);
  });
  it('sends exactly one POST, with the fixed body, and never follows redirects',async()=>{
    const{calls,journal}=await run();
    const posts=calls.filter(c=>c.method==='POST');
    expect(posts).toHaveLength(1);
    expect(new URL(posts[0].url).pathname).toBe(`/v1/projects/${PROJECT}:testIamPermissions`);
    expect(posts[0].body).toBe(TEST_IAM_BODY);
    expect(calls.every(c=>c.redirect==='error')).toBe(true);
    expect(journal.filter(j=>j.method==='POST')).toHaveLength(1);
  });
  it('refuses to continue when the transport would redirect',async()=>{
    const calls:Call[]=[];
    const refusing=async(url:string,init:any)=>{calls.push({url,method:init.method,redirect:init.redirect,headers:init.headers});
      throw new TypeError('redirect mode is set to error - redirected');};
    const error=await runReadback({fetchImpl:refusing as any,getToken:async()=>TOKEN,now:()=>new Date('2026-11-20T12:00:00.000Z'),timeoutMs:5000}).then(()=>null,(e:any)=>e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/transport refused/i);
    expect(error.journal).toHaveLength(1);
    expect(error.journal[0]).toMatchObject({status:null,outcome:'refused',host:'cloudresourcemanager.googleapis.com'});
    expect(JSON.stringify(error.journal)).not.toContain(TOKEN);
  });
});

describe('redaction',()=>{
  it('keeps service accounts and the two public principals, redacts everything else',()=>{
    const bindings=sanitizeBindings({bindings:[{role:'roles/run.invoker',members:[
      'serviceAccount:scheduler@vistavo-prod.iam.gserviceaccount.com',
      'serviceAccount:weird@example.com',
      'user:ana@example.com','group:ops@example.com','domain:example.com','allUsers','allAuthenticatedUsers',
    ]}]});
    expect(bindings[0].members).toEqual(['serviceAccount:scheduler@vistavo-prod.iam.gserviceaccount.com','<other member redacted>','<other member redacted>','<other member redacted>','<other member redacted>','allUsers','allAuthenticatedUsers']);
  });
  it('redacts person e-mails in free text but keeps service-account e-mails',()=>{
    expect(redactText('Alertas de Ana <ana@example.com>')).toBe('Alertas de Ana <<email redacted>>');
    expect(redactText('files@vistavo-prod.iam.gserviceaccount.com')).toBe('files@vistavo-prod.iam.gserviceaccount.com');
    expect(redactText(null)).toBe(null);
    expect(redactText(undefined)).toBe(null);
  });
  it('emits alert policies with name and enabled state only',()=>{
    const policy=sanitizeAlertPolicy({name:'projects/vistavo-prod/alertPolicies/456',displayName:'ana@example.com',enabled:true,conditions:[{},{},{}],notificationChannels:['projects/vistavo-prod/notificationChannels/123']});
    expect(Object.keys(policy).sort()).toEqual(['enabled','name']);
    expect(policy).toEqual({name:'456',enabled:true});
  });
  it('never prints a channel e-mail address',async()=>{
    const{result}=await run();
    const channel=result.monitoring.notificationChannels.channels[0];
    expect(channel).not.toHaveProperty('labels');
    expect(JSON.stringify(channel)).not.toContain('ana@example.com');
    expect(JSON.stringify(result)).not.toContain('ana@example.com');
    expect(JSON.stringify(result)).not.toContain('ops@example.com');
  });
});

describe('unreadable sections',()=>{
  it('records 403 and 404 as unreadable without throwing or retrying',async()=>{
    for(const status of [403,404]){
      const routes:Record<string,Route>={};
      for(const key of Object.keys(base()))routes[key]={status,body:{error:{status:status===403?'PERMISSION_DENIED':'NOT_FOUND'}}};
      const{calls,journal,result}=await run(routes);
      expect(result.identity_permissions.readable).toBe(false);
      expect(result.identity_permissions.httpStatus).toBe(status);
      expect(result.enabled_apis.readable).toBe(false);
      expect(result.cloud_run_services.readable).toBe(false);
      expect(result.service_accounts.readable).toBe(false);
      expect(result.monitoring.notificationChannels.readable).toBe(false);
      expect(result.monitoring.alertPolicies.readable).toBe(false);
      expect(result.monitoring.logMetrics.readable).toBe(false);
      expect(result.scheduler.readable).toBe(false);
      expect(journal.every(j=>j.status===status)).toBe(true);
      expect(calls).toHaveLength(9);
      expect(new Set(calls.map(c=>decodeURIComponent(new URL(c.url).pathname))).size).toBe(9);
    }
  });
  it('keeps one service policy failure local to that service',async()=>{
    const routes=base();
    routes['/v2/projects/vistavo-prod/locations/us-central1/services/vistavo-files-api:getIamPolicy']={status:403,body:{error:{status:'PERMISSION_DENIED'}}};
    const{result}=await run(routes);
    const service=result.cloud_run_services.services[0];
    expect(result.cloud_run_services.readable).toBe(true);
    expect(service.invoker.readable).toBe(false);
    expect(service.invoker.httpStatus).toBe(403);
    expect(service.publicInvoker).toBe(null);
    expect(service.invokerMembers).toEqual([]);
  });
  it('reports an unrecognised quota response instead of an empty quota',()=>{
    expect(summarizeQuotaInfos({})).toEqual({recognised:false,reason:'unrecognized response shape'});
    expect(summarizeQuotaInfos(undefined)).toEqual({recognised:false,reason:'unrecognized response shape'});
    const ok=summarizeQuotaInfos({quotaInfos:[{quotaId:'ServiceAccountCount',dimensionsInfos:[{details:{value:'100'}}]}]});
    expect(ok.recognised).toBe(true);
    expect(ok.rows[0].limits[0].value).toBe('100');
    expect(ok.matched.map((r:any)=>r.quotaId)).toEqual(['ServiceAccountCount']);
  });
});

describe('metadata-only output',()=>{
  it('is stable and carries only metadata',async()=>{
    const first=await run();
    const second=await run();
    expect(JSON.stringify(stable(first))).toBe(JSON.stringify(stable(second)));
    const serialized=JSON.stringify(first.result);
    for(const forbidden of [TOKEN,'Bearer ','MUST-NOT-LEAK','token=','email_address','Authorization'])
      expect(serialized).not.toContain(forbidden);
    expect(first.result.project).toBe(PROJECT);
    expect(first.result.region).toBe('us-central1');
    expect(first.result.generatedAt).toBe('2026-11-20T12:00:00.000Z');
  });
  it('declares permissions, APIs, ingress, invokers and quota',async()=>{
    const{result}=await run();
    expect(result.identity_permissions).toMatchObject({readable:true,requested:14,granted:['datastore.indexes.create','datastore.indexes.list'],unexpected:[]});
    expect(result.identity_permissions.missing).toHaveLength(12);
    expect(result.identity_permissions.capabilities).toMatchObject({createIndex:true,createAlertPolicy:false,createRunService:false,createServiceAccount:false});
    expect(result.enabled_apis.names).toEqual(['monitoring.googleapis.com','run.googleapis.com']);
    expect(result.enabled_apis.needed.find((x:any)=>x.api==='run.googleapis.com')).toEqual({api:'run.googleapis.com',enabled:true});
    expect(result.enabled_apis.needed.find((x:any)=>x.api==='cloudquotas.googleapis.com').enabled).toBe(false);
    const service=result.cloud_run_services.services[0];
    expect(service).toMatchObject({name:'vistavo-files-api',ingress:'INGRESS_TRAFFIC_INTERNAL_ONLY',serviceAccount:'files@vistavo-prod.iam.gserviceaccount.com',latestReadyRevision:'vistavo-files-api-00012-abc',publicInvoker:true});
    expect(service.invokerMembers).toEqual(['serviceAccount:scheduler@vistavo-prod.iam.gserviceaccount.com','<other member redacted>','allUsers']);
    expect(result.service_accounts).toMatchObject({readable:true,count:2,disabled:0});
    expect(result.service_account_quota.readable).toBe(true);
    expect(result.service_account_quota.matched[0].quotaId).toBe('ServiceAccountCount');
    expect(result.monitoring.notificationChannels.channels[0]).toMatchObject({type:'email',enabled:true});
    expect(result.monitoring.alertPolicies.policies[0]).toEqual({name:'456',enabled:true});
    expect(result.monitoring.logMetrics.metrics[0].name).toBe('billing_hold_stuck');
    expect(result.scheduler.jobs[0]).toMatchObject({name:'vistavo-files-maintenance',state:'ENABLED',schedule:'*/5 * * * *'});
    expect(result.scheduler.jobs[0].target).toEqual({method:'POST',host:'vistavo-files-maintenance-abc.a.run.app',path:'/internal/maintenance',oidcServiceAccount:'scheduler@vistavo-prod.iam.gserviceaccount.com'});
  });
  it('states its limits',async()=>{
    const{result}=await run();
    expect(result.limits.metadataOnly).toMatch(/no business data/i);
    expect(result.limits.emptyReadDoesNotProveCapacity).toMatch(/does not prove/i);
    expect(result.limits.emptyBasesDoNotValidateReconciliation).toMatch(/empty/i);
    expect(result.limits.notRead.join(' ')).toMatch(/Secret Manager/i);
    expect(result.limits.notRead.join(' ')).toMatch(/Firestore index/i);
    // No Firestore section exists: only the datastore.indexes.* permissions are probed.
    expect(result.limits.notRead.join(' ')).toMatch(/index definitions/i);
    expect(result.limits.notRead.join(' ')).not.toMatch(/index contents/i);
  });
  it('journals every request with host, path and status but no token',async()=>{
    const{calls,journal,result}=await run();
    expect(journal).toHaveLength(calls.length);
    expect(journal).toHaveLength(10);
    for(const entry of journal){
      expect(Object.keys(entry).sort()).toEqual(['host','method','path','status']);
      expect(entry.host).toMatch(/\.googleapis\.com$/);
      expect(entry.path).toMatch(/^\/v\d+\/projects\/vistavo-prod(?:[\/:]|$)/);
    }
    expect(JSON.stringify(journal)).not.toContain(TOKEN);
    expect(JSON.stringify(journal)).not.toContain('Bearer');
    expect(result.requests).toBe(journal.length);
  });
});

