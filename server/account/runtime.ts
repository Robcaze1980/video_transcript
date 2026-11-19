import {applicationDefault,initializeApp,deleteApp} from 'firebase-admin/app';
import {Firestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {OAuth2Client} from 'google-auth-library';
import {randomUUID} from 'node:crypto';
import {AccountStore} from './backend';

const serviceEmails={api:'vistavo-files-api@vistavo-prod.iam.gserviceaccount.com',worker:'vistavo-runtime@vistavo-prod.iam.gserviceaccount.com'} as const;
export function validateAccountOidcAudience(value:string){
 let url:URL;try{url=new URL(value);}catch{throw Error('Internal account audience boundary');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^vistavo-account-api-[a-z0-9-]+-uc\.a\.run\.app$/.test(url.hostname)||value.endsWith('/'))throw Error('Internal account audience boundary');
 return value;
}
export function trustedServiceClaims(payload:{sub?:string;email?:string;email_verified?:boolean}|undefined,allowedEmails:readonly string[]){
 if(!payload||typeof payload.sub!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(payload.sub)||typeof payload.email!=='string'||!payload.email.endsWith('.iam.gserviceaccount.com')||payload.email_verified!==true||!allowedEmails.includes(payload.email))throw Error('OIDC service identity unavailable');
 return {email:payload.email,email_verified:true as const};
}

export function validateAccountEnvironment(env:NodeJS.ProcessEnv){
 if(env.VISTAVO_ACCOUNT_MODE!=='production'||env.VISTAVO_PROJECT_ID!=='vistavo-prod'||env.VISTAVO_ACCOUNT_DATABASE!=='vistavo-live'||env.GOOGLE_APPLICATION_CREDENTIALS||env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Production account environment boundary');
}
export async function verifyDatabaseBoundary(db:Pick<Firestore,'doc'>,forbidden:Pick<Firestore,'doc'>){
 const marker=(await db.doc('vistavo/production-v1').get()).data();
 if(marker?.service!=='vistavo-account'||marker.environment!=='production'||marker.schemaVersion!==1||marker.unit!=='video_seconds')throw Error('Production account schema boundary');
 let denied=false;try{await forbidden.doc('vistavo/candidate-v1').get();}catch(error){if((error as {code?:number}).code!==7)throw Error('Candidate database denial inconclusive');denied=true;}
 if(!denied)throw Error('Account identity must not access candidate database');
 return {productionDatabaseRead:true as const,candidateDatabaseDenied:true as const};
}
export async function accountRuntime(){
 validateAccountEnvironment(process.env);
 async function metadata(key:string){const r=await fetch('http://metadata.google.internal/computeMetadata/v1/'+key,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});if(!r.ok||r.headers.get('Metadata-Flavor')!=='Google')throw Error('Managed account identity required');return r.text();}
 const [project,email]=await Promise.all([metadata('project/project-id'),metadata('instance/service-accounts/default/email')]);
 if(project!=='vistavo-prod'||email!=='vistavo-account-api@vistavo-prod.iam.gserviceaccount.com')throw Error('Managed account identity mismatch');
 const app=initializeApp({projectId:'vistavo-prod',credential:applicationDefault()},'vistavo-account-'+randomUUID());
 // Stable Google Cloud Firestore constructor, not the preview named initializeFirestore overload.
 const db=new Firestore({projectId:'vistavo-prod',databaseId:'vistavo-live',preferRest:true});
 try{
  const forbidden=new Firestore({projectId:'vistavo-prod',databaseId:'(default)',preferRest:true});
  let boundary;try{boundary=await verifyDatabaseBoundary(db,forbidden);}finally{await forbidden.terminate();}
  // No document contents, UID, email, credential or provider errors are emitted.
  console.log(JSON.stringify({event:'account-database-boundary',method:'Firestore SDK',...boundary}));
  const root=db.collection('vistavo').doc('production-v1');
  const audience=process.env.VISTAVO_ACCOUNT_OIDC_AUDIENCE;
  const allowedEmails=(process.env.VISTAVO_INTERNAL_VIDEO_CALLERS??'').split(',').map(x=>x.trim()).filter(Boolean);
  if(Boolean(audience)!==Boolean(allowedEmails.length)||new Set(allowedEmails).size!==allowedEmails.length||allowedEmails.some(x=>![serviceEmails.api,serviceEmails.worker].includes(x as any))||audience&&allowedEmails.length!==2)throw Error('Internal video caller boundary');
  if(audience)validateAccountOidcAudience(audience);
  const oauth=new OAuth2Client();
  const internal=audience?{audience,allowedEmails,reservationCaller:serviceEmails.api,settlementCaller:serviceEmails.worker,verifier:{verifyIdToken:async(token:string,expectedAudience:string)=>{
   if(expectedAudience!==audience)throw Error('OIDC audience mismatch');
   const ticket=await oauth.verifyIdToken({idToken:token,audience});const payload=ticket.getPayload();
   return trustedServiceClaims(payload,allowedEmails);
  }}}:undefined;
  return {store:new AccountStore(db,root),identity:getAuth(app),internal,close:async()=>{await db.terminate();await deleteApp(app);}};
 }catch(error){await db.terminate();await deleteApp(app);throw error;}
}
