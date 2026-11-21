// A0 read-only readback of the real `vistavo-prod` project. It answers, without changing anything, whether the planned
// changes could be applied later: composite index, alerting metric/channel/policy, a new Cloud Run service with its
// service account, and a new revision of the maintenance service.
//
// Hard guarantees: only GET requests except ONE fixed `projects/vistavo-prod:testIamPermissions` POST (no side effects,
// fixed body); only the hosts in ALLOWED_HOSTS; only paths whose project segment is exactly `vistavo-prod`; no path
// percent-encoding, traversal, credentials or fragments; no redirects; no business data; the access token is never
// printed or stored; person e-mails and non-service IAM members are redacted; every request is journaled.
// Usage: node scripts/a0CloudReadback.mjs <output.json>
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const PROJECT='vistavo-prod';
export const REGION='us-central1';
export const CREDENTIAL_HINT='LinguistVision/gcloud/application_default_credentials.json';

export const ALLOWED_HOSTS=Object.freeze([
  'cloudresourcemanager.googleapis.com',
  'serviceusage.googleapis.com',
  'run.googleapis.com',
  'iam.googleapis.com',
  'monitoring.googleapis.com',
  'logging.googleapis.com',
  'cloudscheduler.googleapis.com',
  'cloudquotas.googleapis.com',
]);

/** Permissions A0 needs an answer for. The probe only asks; it grants nothing and changes nothing. */
export const A0_PERMISSIONS=Object.freeze([
  'datastore.indexes.create',
  'datastore.indexes.list',
  'monitoring.alertPolicies.create',
  'monitoring.notificationChannels.create',
  'monitoring.notificationChannels.list',
  'logging.logMetrics.create',
  'run.services.create',
  'run.services.update',
  'run.services.setIamPolicy',
  'iam.serviceAccounts.create',
  'cloudscheduler.jobs.create',
  'cloudscheduler.jobs.list',
  'secretmanager.secrets.create',
  'serviceusage.services.list',
]);

const IAM_PROBE_PATH=`/v1/projects/${PROJECT}:testIamPermissions`;
/** The single permitted non-GET body: the requested permission list above, serialized once. */
export const TEST_IAM_BODY=JSON.stringify({permissions:[...A0_PERMISSIONS]});
const REDACTED='<other member redacted>';
const EMAIL_REDACTED='<email redacted>';
const SAFE_SEGMENT=/^[A-Za-z0-9._:-]+$/;
const ALLOWED_QUERY_KEYS=Object.freeze(['pageSize','pageToken','filter']);
const MAX_PAGES=20;
const escapeRegExp=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const PROJECT_PATH=new RegExp('^/v\\d+/projects/'+escapeRegExp(PROJECT)+'(?:[/:]|$)');

function refuse(message){throw new Error(message);}

/** The path exactly as written in the URL string, before the URL parser normalizes dot segments. */
function rawPathOf(raw){
  const afterScheme=raw.indexOf('://');
  if(afterScheme<0)refuse('invalid url');
  const rest=raw.slice(afterScheme+3);
  const firstSlash=rest.indexOf('/');
  const withoutQuery=firstSlash<0?'/':rest.slice(firstSlash);
  return withoutQuery.split('#')[0].split('?')[0];
}

/**
 * @typedef {{host:string,method:string,path:string,status:number|null,outcome?:string}} JournalEntry
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,reason?:string,requested?:number,recognised?:boolean,granted?:string[],missing?:string[],unexpected?:string[],capabilities?:Record<string,boolean>}} PermissionSection
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,names?:string[],needed?:{api:string,enabled:boolean}[]},truncated?:boolean} ApiSection
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,members?:string[],publicInvoker?:boolean|null}} InvokerSection
 * @typedef {{name:string,ingress:string|null,invokerIamCheck:string,latestReadyRevision:string|null,serviceAccount:string|null,minInstances:number|null,maxInstances:number|null,timeout:string|null,invoker:InvokerSection,invokerMembers:string[],publicInvoker:boolean|null}} RunService
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,services?:RunService[]},truncated?:boolean} RunSection
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,disabled?:number},truncated?:boolean} AccountSection
 * @typedef {{quotaId:string|null,displayName:string|null,isPrecise:boolean|null,limits:{dimensions:any,value:string|null}[]}} QuotaRow
 * @typedef {{recognised:boolean,reason?:string,rows?:QuotaRow[],matched?:QuotaRow[]}} QuotaSummary
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,note?:string,recognised?:boolean,reason?:string,rows?:QuotaRow[],matched?:QuotaRow[]}} QuotaSection
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,channels?:{type:string|null,displayName:string|null,enabled:boolean,verificationStatus:string|null}[]},truncated?:boolean} ChannelSection
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,policies?:{name:string|null,enabled:boolean}[]},truncated?:boolean} PolicySection
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,metrics?:{name:string|null,type:string|null}[]},truncated?:boolean} MetricSection
 * @typedef {{method:string|null,host:string|null,path:string|null,oidcServiceAccount:string|null}} JobTarget
 * @typedef {{readable:boolean,httpStatus?:number,error?:string,count?:number,jobs?:{name:string|null,state:string|null,schedule:string|null,timeZone:string|null,target:JobTarget|null,lastAttemptTime:string|null,lastStatusCode:number|null,retryCount:number|null,attemptDeadline:string|null}[],truncated?:boolean}} SchedulerSection
 * @typedef {{project:string,region:string,generatedAt:string,mode:string,identity_permissions:PermissionSection,enabled_apis:ApiSection,cloud_run_services:RunSection,service_accounts:AccountSection,service_account_quota:QuotaSection,monitoring:{notificationChannels:ChannelSection,alertPolicies:PolicySection,logMetrics:MetricSection},scheduler:SchedulerSection,limits:Record<string,any>,requests:number,methods:string[]}} ReadbackResult
 */
/** Closed query list: no key outside ALLOWED_QUERY_KEYS, no duplicates, bounded printable values. */
function assertQuery(searchParams){
  const seen=new Set();
  for(const key of searchParams.keys()){
    if(!ALLOWED_QUERY_KEYS.includes(key))refuse('query parameter refused: '+key);
    if(seen.has(key))refuse('query parameter refused: duplicated '+key);
    seen.add(key);
  }
  const pageSize=searchParams.get('pageSize');
  if(pageSize!==null&&!(/^[1-9]\d{0,3}$/.test(pageSize)&&Number(pageSize)<=1000))refuse('query parameter refused: pageSize');
  const pageToken=searchParams.get('pageToken');
  // Opaque: Google page tokens are base64 and may contain '+', '/' and '='. Only control characters and blanks are refused.
  if(pageToken!==null&&!/^[\x21-\x7e]{1,4096}$/.test(pageToken))refuse('query parameter refused: pageToken');
  const filter=searchParams.get('filter');
  if(filter!==null&&!(filter.length<=512&&/^[\x20-\x7e]+$/.test(filter)))refuse('query parameter refused: filter');
}

/**
 * Accepts a URL only when it is https, on an allowed host, free of credentials/fragments/percent-encoding and under
 * exactly `projects/vistavo-prod`. Percent-encoding is refused outright: a decoded `%2e` could otherwise walk out of
 * the project, and this script never needs an encoded path segment.
 * @param {string} raw
 * @returns {URL}
 */
export function assertUrl(raw){
  let parsed;
  try{parsed=new URL(raw);}catch{refuse('invalid url');}
  if(parsed.protocol!=='https:')refuse('only https urls are allowed');
  if(parsed.username||parsed.password)refuse('url credentials refused');
  // An explicit port is never needed for these APIs; allowing one would let a request leave the closed host list.
  if(parsed.port!=='')refuse('url port refused');
  if(parsed.hash)refuse('url fragment refused');
  if(!ALLOWED_HOSTS.includes(parsed.hostname))refuse('host refused: '+parsed.hostname);
  if(parsed.pathname.includes('%'))refuse('encoded or non canonical path refused');
  // The parser rewrites dot segments (`/../`, `%2e%2e`) before we ever see them. Require the path we will request to be
  // byte-for-byte the path that was handed in, so a rewrite is refused instead of silently redirected to another route.
  if(rawPathOf(raw)!==parsed.pathname)refuse('encoded or non canonical path refused');
  if(parsed.pathname.split('/').includes('..')||parsed.pathname.split('/').includes('.'))refuse('encoded or non canonical path refused');
  if(!PROJECT_PATH.test(parsed.pathname))refuse('foreign project path refused');
  assertQuery(parsed.searchParams);
  return parsed;
}

/**
 * Validates the method/body contract: GET without body, or the one POST to the permissions probe with the exact fixed
 * body and no query string. Returns the accepted method.
 * @param {{method:string,url:string,body?:string}} request
 * @returns {'GET'|'POST'}
 */
export function assertRequest({method,url,body}){
  const parsed=assertUrl(url);
  if(method==='GET'){
    if(body!==undefined)refuse('GET with body refused');
    return 'GET';
  }
  if(method!=='POST')refuse('method refused: '+String(method));
  if(parsed.pathname!==IAM_PROBE_PATH||parsed.search!=='')refuse('POST refused: only the fixed permissions probe');
  if(body!==TEST_IAM_BODY)refuse('body refused: the permissions probe body is fixed');
  return 'POST';
}

/**
 * Person e-mails are replaced; service-account addresses are metadata and stay.
 * @param {unknown} value
 * @returns {string|null}
 */
export function redactText(value){
  if(typeof value!=='string')return null;
  return value.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,match=>
    match.endsWith('.gserviceaccount.com')?match:EMAIL_REDACTED);
}

const keepMember=member=>typeof member==='string'&&(/^serviceAccount:[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(member)||member==='allUsers'||member==='allAuthenticatedUsers');

/**
 * Positive list: only real service accounts and the two public principals survive; everything else is labelled.
 * @param {any} policy
 * @returns {{role:string|null,members:string[]}[]}
 */
export function sanitizeBindings(policy){
  return (policy?.bindings??[]).map(binding=>({
    role:typeof binding?.role==='string'?binding.role:null,
    members:(binding?.members??[]).map(member=>keepMember(member)?member:REDACTED),
  }));
}

const unique=values=>values.filter((value,index)=>values.indexOf(value)===index);

/**
 * Alert policies: name (last segment) and enabled state only; conditions and channels are not copied.
 * @param {any} policy
 * @returns {{name:string|null,enabled:boolean}}
 */
export function sanitizeAlertPolicy(policy){
  const name=typeof policy?.name==='string'?policy.name.split('/').pop():null;
  return {name:name??null,enabled:policy?.enabled===true};
}

/**
 * Compares the requested permissions with what the API reported. An empty or unrecognised response is never read as
 * "no permissions": it is unreadable, and the caller reports it as such.
 * @param {any} data
 * @returns {{recognised:boolean,reason?:string,granted?:string[],missing?:string[],unexpected?:string[],capabilities?:Record<string,boolean>}}
 */
export function summarizePermissions(data){
  const reported=data?.permissions;
  if(!Array.isArray(reported))return {recognised:false,reason:'unrecognized response shape'};
  const granted=new Set(reported.filter(entry=>typeof entry==='string'));
  const has=permission=>granted.has(permission);
  return {
    recognised:true,
    granted:[...A0_PERMISSIONS].filter(has),
    missing:[...A0_PERMISSIONS].filter(permission=>!has(permission)),
    unexpected:[...granted].filter(permission=>!A0_PERMISSIONS.includes(permission)).sort(),
    capabilities:{
      createIndex:has('datastore.indexes.create'),
      listIndexes:has('datastore.indexes.list'),
      createAlertPolicy:has('monitoring.alertPolicies.create'),
      createNotificationChannel:has('monitoring.notificationChannels.create'),
      listNotificationChannels:has('monitoring.notificationChannels.list'),
      createLogMetric:has('logging.logMetrics.create'),
      createRunService:has('run.services.create'),
      updateRunService:has('run.services.update'),
      setRunServiceIamPolicy:has('run.services.setIamPolicy'),
      createServiceAccount:has('iam.serviceAccounts.create'),
      createSchedulerJob:has('cloudscheduler.jobs.create'),
      listSchedulerJobs:has('cloudscheduler.jobs.list'),
      createSecret:has('secretmanager.secrets.create'),
      listServices:has('serviceusage.services.list'),
    },
  };
}

/**
 * Quota limits are readable metadata; a limit is not a remaining margin, so the shape is kept explicit.
 * @param {any} data
 * @returns {QuotaSummary}
 */
export function summarizeQuotaInfos(data){
  if(!data||typeof data!=='object'||!Array.isArray(data.quotaInfos))return {recognised:false,reason:'unrecognized response shape'};
  const rows=data.quotaInfos.filter(quota=>quota&&typeof quota==='object').map(quota=>({
    quotaId:typeof quota.quotaId==='string'?quota.quotaId:null,
    displayName:typeof quota.quotaDisplayName==='string'?quota.quotaDisplayName:null,
    isPrecise:typeof quota.isPrecise==='boolean'?quota.isPrecise:null,
    limits:(Array.isArray(quota.dimensionsInfos)?quota.dimensionsInfos:[]).map(dimension=>({
      dimensions:dimension?.dimensions??null,
      value:dimension?.details?.value??null,
    })),
  }));
  const normalise=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
  return {recognised:true,rows,matched:rows.filter(row=>row.quotaId!==null&&(normalise(row.quotaId).includes('serviceaccountcount')||normalise(row.displayName).includes('serviceaccountcount')))};
}

const short=name=>typeof name==='string'?name.split('/').pop():null;
// Only these Google error statuses are copied through; anything else becomes 'unknown', so no object body can leak.
const KNOWN_ERROR_STATUSES=Object.freeze(['PERMISSION_DENIED','NOT_FOUND','UNAVAILABLE','INTERNAL','INVALID_ARGUMENT','FAILED_PRECONDITION','RESOURCE_EXHAUSTED','UNAUTHENTICATED','ABORTED','ALREADY_EXISTS','CANCELLED','DEADLINE_EXCEEDED','OUT_OF_RANGE','UNIMPLEMENTED']);
const failureError=response=>{
  const reported=response?.data?.error?.status;
  return typeof reported==='string'&&KNOWN_ERROR_STATUSES.includes(reported)?reported:'unknown';
};
const failure=response=>({readable:false,httpStatus:response.status,error:failureError(response)});
/** A Cloud Run service name must be a plain path segment; anything else is reported, never requested. */
export const segment=value=>{
  // `.` and `..` pass the character set but are dot segments, so they are refused by name as well.
  if(typeof value!=='string'||!SAFE_SEGMENT.test(value)||value==='.'||value==='..')refuse('unsafe resource segment');
  return value;
};

const NEEDED_APIS=Object.freeze([
  'firestore.googleapis.com',
  'monitoring.googleapis.com',
  'logging.googleapis.com',
  'run.googleapis.com',
  'iam.googleapis.com',
  'cloudscheduler.googleapis.com',
  'cloudquotas.googleapis.com',
  'serviceusage.googleapis.com',
]);

/**
 * Runs every readback request against the injected transport. Nothing here touches the network by itself, so the
 * tests can supply a double and the CLI can supply authenticated fetch.
 * @param {{fetchImpl?:any,getToken?:() => Promise<string>,now?:() => Date,timeoutMs?:number}} [options]
 * @returns {Promise<{journal:JournalEntry[],result:ReadbackResult}>}
 */
export async function runReadback({fetchImpl,getToken,now=()=>new Date(),timeoutMs=60000,onJournal}={}){
  if(typeof fetchImpl!=='function')refuse('fetch implementation is required');
  if(typeof getToken!=='function')refuse('token source is required');
  const journal=[];
  // Sections a page cap cut short: the list stays readable but is a lower bound, never a complete inventory.
  const truncatedSections=[];
  let token;
  const auth=async()=>{
    if(token===undefined){
      const issued=await getToken();
      if(typeof issued!=='string'||issued.length<8)refuse('access token unavailable');
      token=issued;
    }
    return token;
  };
  // The observer sees every journal append, including refusals, so a failed run can still persist what it did.
  const record=entry=>{
    journal.push(entry);
    if(typeof onJournal==='function')onJournal(entry);
  };

  async function request(method,url,body){
    const accepted=assertRequest({method:method??'GET',url,body});
    const parsed=assertUrl(url);
    // Credentials on every request. A JSON content type only where a body is actually sent: fetch would otherwise
    // label the fixed string body as text/plain, which Google APIs may reject.
    const headers={Authorization:'Bearer '+await auth(),'x-goog-user-project':PROJECT,...(body===undefined?{}:{'Content-Type':'application/json'})};
    let response;
    try{
      const init={method:accepted,headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs)};
      if(body!==undefined)init.body=body;
      response=await fetchImpl(parsed,init);
    }catch(error){
      // A refused transport still leaves its entry, and the partial journal travels with the error.
      record({host:parsed.hostname,method:accepted,path:parsed.pathname,status:null,outcome:'refused'});
      const refused=new Error('request transport refused');
      refused.cause=error;
      refused.journal=journal.slice();
      throw refused;
    }
    let data;
    try{data=await response.json();}catch{data=undefined;}
    record({host:parsed.hostname,method:accepted,path:parsed.pathname,status:response.status});
    return {status:response.status,data};
  }
  const get=url=>request('GET',url,undefined);

  async function listAll(base,key){
    const rows=[];
    let pageToken;
    for(let page=0;page<MAX_PAGES;page++){
      const url=base+(pageToken?(base.includes('?')?'&':'?')+'pageToken='+encodeURIComponent(pageToken):'');
      const response=await get(url);
      // A page that is not 200 ends the section: the rows already read are reported as partial, never as a full list.
      if(response.status!==200)return {...failure(response),partialRows:rows.length};
      rows.push(...(response.data?.[key]??[]));
      pageToken=response.data?.nextPageToken;
      if(!pageToken)break;
      // The cap stopped the walk with a page still pending: report it instead of implying we read everything.
      if(page===MAX_PAGES-1){truncatedSections.push(new URL(base).pathname);return {readable:true,rows,truncated:true};}
    }
    return {readable:true,rows};
  }

  // (a) Effective permissions: the only POST, with the fixed body, against the permissions probe.
  const permissions=await request('POST',`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`,TEST_IAM_BODY);
  let identity_permissions;
  if(permissions.status===200){
    const summary=summarizePermissions(permissions.data);
    identity_permissions=summary.recognised
      ?{readable:true,requested:A0_PERMISSIONS.length,...summary}
      :{readable:false,httpStatus:permissions.status,error:'unrecognized response shape'};
  }else identity_permissions=failure(permissions);

  // (b) Enabled APIs: names only.
  const services=await listAll(`https://serviceusage.googleapis.com/v1/projects/${PROJECT}/services?filter=state:ENABLED&pageSize=200`,'services');
  let enabled_apis;
  if(services.readable){
    const names=services.rows.map(service=>service?.config?.name).filter(name=>typeof name==='string').sort();
    enabled_apis={readable:true,count:names.length,names,needed:NEEDED_APIS.map(api=>({api,enabled:names.includes(api)})),...(services.truncated?{truncated:true}:{})};
  }else enabled_apis=services;

  // (c) Cloud Run services: ingress, current revision, service account and invoker policy.
  const runServices=await listAll(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services?pageSize=100`,'services');
  let cloud_run_services;
  if(runServices.readable){
    const rows=[];
    for(const service of runServices.rows){
      let name;
      try{name=segment(short(service?.name)??'');}
      catch{
        // Keep the entry, name it as unusable and skip its policy: one bad name must not hide the rest.
        rows.push({name:null,error:'unsafe resource name',ingress:service?.ingress??null,invokerIamCheck:null,latestReadyRevision:null,serviceAccount:null,minInstances:null,maxInstances:null,timeout:null,invoker:{readable:false,error:'unsafe resource name',members:[],publicInvoker:null},invokerMembers:[],publicInvoker:null});
        continue;
      }
      const policy=await get(`https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services/${name}:getIamPolicy`);
      let invoker;
      if(policy.status===200){
        const bindings=sanitizeBindings(policy.data);
        const members=unique(bindings.filter(binding=>binding.role==='roles/run.invoker').flatMap(binding=>binding.members));
        invoker={readable:true,members,publicInvoker:members.some(member=>member==='allUsers'||member==='allAuthenticatedUsers')};
      }else{
        invoker={...failure(policy),members:[],publicInvoker:null};
      }
      rows.push({
        name,
        ingress:service?.ingress??null,
        invokerIamCheck:service?.invokerIamDisabled===true?'DISABLED':'enabled',
        latestReadyRevision:short(service?.latestReadyRevision),
        serviceAccount:service?.template?.serviceAccount??service?.template?.serviceAccountEmail??null,
        minInstances:service?.scaling?.minInstanceCount??service?.template?.scaling?.minInstanceCount??null,
        maxInstances:service?.template?.scaling?.maxInstanceCount??service?.scaling?.maxInstanceCount??null,
        timeout:service?.template?.timeout??null,
        invoker,
        invokerMembers:invoker.members,
        publicInvoker:invoker.publicInvoker,
      });
    }
    cloud_run_services={readable:true,count:rows.length,services:rows,...(runServices.truncated?{truncated:true}:{})};
  }else cloud_run_services=runServices;

  // (d) Service accounts: count only (same criterion as P0), plus the quota limit when it is readable.
  const accounts=await listAll(`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts?pageSize=100`,'accounts');
  const service_accounts=accounts.readable
    ?{readable:true,count:accounts.rows.length,disabled:accounts.rows.filter(account=>account?.disabled===true).length,...(accounts.truncated?{truncated:true}:{})}
    :accounts;
  const quota=await listAll(`https://cloudquotas.googleapis.com/v1/projects/${PROJECT}/locations/global/services/iam.googleapis.com/quotaInfos?pageSize=100`,'quotaInfos');
  const service_account_quota=quota.readable
    ?{readable:true,note:'quota limits are not a remaining margin',...summarizeQuotaInfos({quotaInfos:quota.rows}),...(quota.truncated?{truncated:true}:{})}
    :quota;

  // (e) Cloud Monitoring: channels (type and redacted name), policies (name and state), log-based metrics.
  const channels=await listAll(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/notificationChannels?pageSize=100`,'notificationChannels');
  const notificationChannels=channels.readable
    ?{readable:true,count:channels.rows.length,...(channels.truncated?{truncated:true}:{}),channels:channels.rows.map(channel=>({
      type:typeof channel?.type==='string'?channel.type:null,
      displayName:redactText(channel?.displayName),
      enabled:channel?.enabled===true,
      verificationStatus:typeof channel?.verificationStatus==='string'?channel.verificationStatus:null,
    }))}
    :channels;
  const policies=await listAll(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/alertPolicies?pageSize=100`,'alertPolicies');
  const alertPolicies=policies.readable
    ?{readable:true,count:policies.rows.length,...(policies.truncated?{truncated:true}:{}),policies:policies.rows.map(sanitizeAlertPolicy)}
    :policies;
  const metrics=await listAll(`https://logging.googleapis.com/v2/projects/${PROJECT}/metrics?pageSize=100`,'metrics');
  const logMetrics=metrics.readable
    ?{readable:true,count:metrics.rows.length,...(metrics.truncated?{truncated:true}:{}),metrics:metrics.rows.map(metric=>({
      name:short(metric?.name),
      type:typeof metric?.metricDescriptor?.type==='string'?metric.metricDescriptor.type:null,
    }))}
    :metrics;

  // (f) Cloud Scheduler: same criterion as P0, without the target URL query string.
  const jobs=await listAll(`https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs?pageSize=100`,'jobs');
  const scheduler=jobs.readable
    ?{readable:true,count:jobs.rows.length,...(jobs.truncated?{truncated:true}:{}),jobs:jobs.rows.map(job=>{
      let target=null;
      if(job?.httpTarget){
        let parsedUri=null;
        try{parsedUri=job.httpTarget.uri?new URL(job.httpTarget.uri):null;}catch{parsedUri=null;}
        target={method:job.httpTarget.httpMethod??null,host:redactText(parsedUri?.hostname),path:redactText(parsedUri?.pathname),oidcServiceAccount:job.httpTarget.oidcToken?.serviceAccountEmail??null};
      }
      return {name:short(job?.name),state:job?.state??null,schedule:job?.schedule??null,timeZone:job?.timeZone??null,target,lastAttemptTime:job?.lastAttemptTime??null,lastStatusCode:job?.status?.code??null,retryCount:job?.retryConfig?.retryCount??null,attemptDeadline:job?.attemptDeadline??null};
    })}
    :jobs;

  const result={
    project:PROJECT,
    region:REGION,
    generatedAt:now().toISOString(),
    mode:'metadata only; GET plus one fixed testIamPermissions POST; read-only scope',
    identity_permissions,
    enabled_apis,
    cloud_run_services,
    service_accounts,
    service_account_quota,
    monitoring:{notificationChannels,alertPolicies,logMetrics},
    scheduler,
    limits:{
      metadataOnly:'metadata only: no business data, no log entries, no secret values and no execution results were read',
      emptyReadDoesNotProveCapacity:'an empty or unreadable section does not prove capacity: a limit or permission that is not visible stays unknown',
      emptyBasesDoNotValidateReconciliation:'empty production bases do not validate the reconciliation rules; they have never run on real data',
      quotaIsNotMargin:'the service-account quota is a limit, not the remaining margin; actual headroom is unknown',
      truncatedLists:'a section marked truncated stopped at the page cap; its list is a lower bound, not the complete inventory',
      truncatedSections:[...truncatedSections],
      notRead:[
        'Firestore business documents',
        'Log entries, metric data points and execution results',
        'Secret Manager secrets and their values',
        'The project IAM policy (it would need a POST beyond the fixed permissions probe)',
        'VPC, Serverless VPC connectors and network settings',
        'Real billing cost, budgets and spend',
        'Firestore index definitions: this script has no Firestore section, it only probes the datastore.indexes.* permissions',
        'The contents and build date of the deployed images',
      ],
    },
    requests:journal.length,
    methods:[...new Set(journal.map(entry=>entry.method))].sort(),
  };
  return {journal,result};
}

/**
 * Derives the journal path from the result path. The result must end in `.json` and the journal must land on a
 * different file, so a mistyped path can never overwrite the result with the journal.
 * @param {string} outputPath
 * @returns {string}
 */
export function journalPathFor(outputPath){
  if(typeof outputPath!=='string'||!outputPath.endsWith('.json'))refuse('output path must end in .json');
  if(path.basename(outputPath)==='.json')refuse('output path must name a file, not just the .json suffix');
  if(outputPath.endsWith('.journal.json'))refuse('output path must not already be a journal path');
  // Replacing the trailing `.json` always changes the name, so the journal can never land on the result file.
  const journal=outputPath.replace(/\.json$/,'.journal.json');
  return journal;
}

/**
 * CLI entry point. Everything it touches is injectable, so the tests never need credentials or the network.
 * @param {{outputPath?:string,argv?:string[],fetchImpl?:any,getToken?:() => Promise<string>,now?:() => Date,timeoutMs?:number,writeFile?:any,log?:any}} [options]
 * @returns {Promise<{ok:boolean,requests:number}>}
 */
export async function main({outputPath,argv=process.argv,fetchImpl,getToken,now,timeoutMs,writeFile=writeFileSync,log=console.log}={}){
  const out=outputPath??argv[2];
  if(!out)refuse('usage: node scripts/a0CloudReadback.mjs <output.json>');
  const journalPath=journalPathFor(out);
  const journal=[];
  try{
    let transport=fetchImpl;
    let tokens=getToken;
    if(typeof transport!=='function'||typeof tokens!=='function'){
      const credentialPath=path.join(process.env.LOCALAPPDATA??'',CREDENTIAL_HINT);
      const {GoogleAuth}=await import('google-auth-library');
      const client=await new GoogleAuth({keyFilename:credentialPath,scopes:['https://www.googleapis.com/auth/cloud-platform.read-only']}).getClient();
      transport=transport??fetch;
      tokens=tokens??(async()=>{
        const {token}=await client.getAccessToken();
        if(!token)refuse('access token unavailable');
        return token;
      });
    }
    const outcome=await runReadback({fetchImpl:transport,getToken:tokens,now,timeoutMs,onJournal:entry=>journal.push(entry)});
    writeFile(out,JSON.stringify(outcome.result,null,2));
    log(JSON.stringify({ok:true,requests:outcome.journal.length,nonOk:outcome.journal.filter(entry=>entry.status!==200).map(entry=>({path:entry.path,status:entry.status}))}));
    return {ok:true,requests:outcome.journal.length};
  }finally{
    // Written on success and on failure alike: what was attempted is always on disk, without tokens or bodies.
    writeFile(journalPath,JSON.stringify({
      project:PROJECT,
      note:'one fixed testIamPermissions POST plus GET requests; hosts, paths, methods and HTTP status; no tokens, bodies or e-mails',
      requests:journal,
    },null,2));
  }
}

const invokedAsScript=typeof process.argv[1]==='string'&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(invokedAsScript)main().catch(error=>{
  console.error(JSON.stringify({ok:false,error:error?.message??'failed'}));
  process.exitCode=1;
});
