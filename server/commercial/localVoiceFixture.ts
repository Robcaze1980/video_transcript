import type {DocumentReference, DocumentSnapshot, Firestore} from 'firebase-admin/firestore';

export const LOCAL_VOICE_ROOT_PURPOSE = 'review-contract-synthetic-v1';
export const LOCAL_VOICE_PROJECT = 'demo-vistavo-ledger';
export const LOCAL_VOICE_CONFLICTS = 'localVoiceReserveConflicts';
export const localVoiceRequestUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/i;

export function isLocalVoiceFixtureTarget(db:Firestore|undefined,root:DocumentReference):boolean {
  if(process.env.NODE_ENV!=='test'||process.env.LV_VOICE_C1_FIXTURE!=='1'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8185'||!db||root.firestore!==db)return false;
  const client=db as unknown as {
    projectId?:string; databaseId?:string; _settings?:{servicePath?:string;port?:number;ssl?:boolean};
  };
  return client.projectId===LOCAL_VOICE_PROJECT&&client.databaseId==='(default)'&&
    client._settings?.servicePath==='127.0.0.1'&&client._settings.port===8185&&client._settings.ssl===false&&
    root.parent?.path==='vistavo_review_contract_synthetic'&&localVoiceRequestUuid.test(root.id);
}

export function isMarkedLocalVoiceRoot(root:DocumentSnapshot):boolean {
  const marker=root.get('marker');
  return root.exists&&root.get('purpose')===LOCAL_VOICE_ROOT_PURPOSE&&root.get('project')===LOCAL_VOICE_PROJECT&&
    root.get('localRequestKeyIndex')===1&&typeof marker==='string'&&localVoiceRequestUuid.test(marker);
}
