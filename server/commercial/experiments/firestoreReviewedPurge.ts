import { Buffer } from 'node:buffer';
import { FieldPath, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { privateUuid } from '../privateObjectPlan';

/**
 * Disabled local prototype: bounded deletion of review rows and retirement of
 * request receipts. Nothing registers or schedules it. It cannot start or close
 * a purge, establish a lease, inventory legacy data, or purge objects/jobs.
 */
export class ReviewedPurgeFault extends Error {
  constructor(readonly code:'disabled'|'invalid'|'conflict'|'lease_lost'|'invariant') { super(code); }
}

type PageKind='reviews'|'requests';
type Lease=Readonly<{accountId:string;inputId:string;purgeGeneration:string;leaseToken:string;leaseGeneration:number}>;
type Result=Readonly<{processed:number;cursor:string|null;endOfScan:boolean}>;

function fault(code:ReviewedPurgeFault['code']):never { throw new ReviewedPurgeFault(code); }
function copyLease(value:unknown):Lease {
  if(!value||typeof value!=='object'||Array.isArray(value))return fault('invalid');
  const proto=Object.getPrototypeOf(value),names=['accountId','inputId','purgeGeneration','leaseToken','leaseGeneration'];
  if(proto!==Object.prototype&&proto!==null)return fault('invalid');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==names.length||keys.some(key=>typeof key!=='string'||!names.includes(key)))return fault('invalid');
  const fields:Record<string,unknown>=Object.create(null);
  for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(value,name);if(!descriptor||!('value' in descriptor))return fault('invalid');fields[name]=descriptor.value;}
  for(const name of ['accountId','inputId','purgeGeneration','leaseToken'])if(typeof fields[name]!=='string'||!privateUuid.test(fields[name] as string))return fault('invalid');
  if(!Number.isSafeInteger(fields.leaseGeneration)||Number(fields.leaseGeneration)<1)return fault('invalid');
  return Object.freeze({accountId:fields.accountId as string,inputId:fields.inputId as string,purgeGeneration:fields.purgeGeneration as string,
    leaseToken:fields.leaseToken as string,leaseGeneration:fields.leaseGeneration as number});
}
function validCursor(value:unknown):value is string|null {
  return value===null||(typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!value.includes('/')&&Buffer.byteLength(value,'utf8')<=1500&&Buffer.from(value,'utf8').toString('utf8')===value);
}

export class FirestoreReviewedPurge {
  private readonly enabled:boolean;
  constructor(private readonly db:Firestore,private readonly root:DocumentReference,options:{enableLocalPrototype?:true}={}) {
    this.enabled=options.enableLocalPrototype===true;
  }

  async processPage(rawLease:unknown,kind:PageKind,pageSize=20):Promise<Result> {
    if(!this.enabled)return fault('disabled');
    const lease=copyLease(rawLease);
    if((kind!=='reviews'&&kind!=='requests')||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>50)return fault('invalid');
    const {accountId,inputId,purgeGeneration,leaseToken,leaseGeneration}=lease;
    const input=this.root.collection('inputs').doc(inputId),upload=this.root.collection('uploads').doc(inputId);
    const control=this.root.collection('reviewPurgeControls').doc(inputId);
    const collection=kind==='reviews'?'reviewedTranslations':'reviewRequests';
    const cursorField=kind==='reviews'?'reviewCursor':'requestCursor';
    return this.db.runTransaction(async tx=>{
      const [inputDoc,uploadDoc,controlDoc]=await tx.getAll(input,upload,control);
      if(!inputDoc.exists||inputDoc.get('accountId')!==accountId||inputDoc.get('deleted')!==true||inputDoc.get('reviewPurgeGeneration')!==purgeGeneration||
         !uploadDoc.exists||uploadDoc.get('id')!==inputId||uploadDoc.get('accountId')!==accountId||uploadDoc.get('state')!=='deleting'||uploadDoc.get('reviewPurgeGeneration')!==purgeGeneration||
         !controlDoc.exists||controlDoc.get('kind')!=='private-review-purge-v1'||controlDoc.get('state')!=='deleting'||controlDoc.get('accountId')!==accountId||controlDoc.get('inputId')!==inputId||controlDoc.get('purgeGeneration')!==purgeGeneration)return fault('conflict');
      const currentGeneration=controlDoc.get('leaseGeneration'),until=controlDoc.get('leaseUntil'),now=Date.now();
      if(!Number.isSafeInteger(now)||!Number.isSafeInteger(currentGeneration)||!Number.isSafeInteger(until)||
         currentGeneration!==leaseGeneration||controlDoc.get('leaseToken')!==leaseToken||until<=now)return fault('lease_lost');
      const cursor=controlDoc.get(cursorField);
      if(!validCursor(cursor))return fault('invariant');
      let query=this.root.collection(collection).where('accountId','==',accountId).where('inputId','==',inputId).orderBy(FieldPath.documentId()).limit(pageSize);
      if(cursor!==null)query=query.startAfter(cursor);
      const rows=await tx.get(query);
      if(rows.docs.length>pageSize)return fault('invariant');
      for(const row of rows.docs){
        if(!row.exists||!validCursor(row.id)||row.id===null||row.ref.path!==`${this.root.path}/${collection}/${row.id}`||
           row.get('accountId')!==accountId||row.get('inputId')!==inputId)return fault('invariant');
      }
      // No reads after the first write. The full overwrite is essential: even
      // non-active/older receipts must lose their input and content-derived data.
      for(const row of rows.docs){
        if(kind==='reviews')tx.delete(row.ref);
        else tx.set(row.ref,{version:2,state:'retired',accountId});
      }
      const next=rows.docs.length?rows.docs[rows.docs.length-1].id:cursor;
      tx.update(control,{[cursorField]:next});
      tx.update(upload,{reviewPurgeGeneration:purgeGeneration});
      // End of this forward scan is not proof of final deletion: a later
      // verification from the beginning and the other purge stages are required.
      return Object.freeze({processed:rows.docs.length,cursor:next,endOfScan:rows.docs.length<pageSize});
    });
  }
}
