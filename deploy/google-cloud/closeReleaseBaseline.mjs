import {createHash} from 'node:crypto';
export const closeBaselineImage='us-central1-docker.pkg.dev/vistavo-prod/vistavo/files@sha256:0b8bbd0e83f4d180185296897c3f7c8c9adb9bf76110eb597f3fc78e84a28b57';
export const closeBaselinePaths=Object.freeze({state:'outputs/vistavo-stabilization/ai-deploy-state.json',ready:'outputs/vistavo-stabilization/ai-deploy-ready.json',readback:'outputs/vistavo-stabilization/cloud-readback.json',acceptance:'outputs/vistavo-stabilization/gemini-recovery-final-acceptance.json'});
const location='projects/vistavo-prod/locations/us-central1';
export const closeResourceNames=Object.freeze(['services/vistavo-files-api','services/vistavo-files-maintenance','jobs/vistavo-files-validate','jobs/vistavo-files-cleanup','jobs/vistavo-ai-process'].map(name=>location+'/'+name).sort());
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Pure local trust-chain check. No credentials, cloud requests or receipt writes. */
export function verifyCloseBaseline({stateBytes,readyBytes,readbackBytes,acceptanceBytes}){
 const state=JSON.parse(stateBytes),ready=JSON.parse(readyBytes),readback=JSON.parse(readbackBytes),acceptance=JSON.parse(acceptanceBytes);
 const exactNames=rows=>Array.isArray(rows)&&rows.length===5&&JSON.stringify(rows.map(row=>row.name).sort())===JSON.stringify(closeResourceNames);
 const readbackBinding=acceptance.evidence?.filter(row=>row.file===closeBaselinePaths.readback);
 if(acceptance.task!=='LV-007.STAB/LV-017.LOCAL'||acceptance.result!=='PASS'||acceptance.acceptedBy!=='Codex'||acceptance.publicRelease!==false||acceptance.fullReportRead!==true||readbackBinding?.length!==1||readbackBinding[0].sha256!==sha(readbackBytes))throw Error('Previous accepted baseline trust/readback binding incomplete');
 if(state.project!=='vistavo-prod'||state.complete!==true||state.image!==closeBaselineImage||state.labels?.app!=='vistavo'||state.labels.phase!=='ai-candidate'||state.labels.managedby!=='codex-lv007-ai'||
  JSON.stringify(Object.keys(state.resources??{}).sort())!==JSON.stringify(closeResourceNames)||ready.project!=='vistavo-prod'||ready.image!==closeBaselineImage||!exactNames(ready.resources)||readback.project!=='vistavo-prod'||readback.image!==closeBaselineImage||!exactNames(readback.resources)||readback.cloudSql?.httpStatus!==200||readback.cloudSql.instances!==0)throw Error('Previous accepted baseline image/resources/private proof incomplete');
 for(const name of closeResourceNames){const saved=state.resources[name],proof=ready.resources.find(row=>row.name===name),live=readback.resources.find(row=>row.name===name);
  if(!saved.uid||saved.verified!==true||saved.image!==closeBaselineImage||saved.operation||saved.failed||proof.uid!==saved.uid||proof.image!==closeBaselineImage||proof.verified!==true||live.uid!==saved.uid||live.image!==closeBaselineImage||live.publicInvoker!==false)throw Error('Previous accepted baseline UID/image mismatch');
  if(name.includes('/services/')&&(live.ingress!=='INGRESS_TRAFFIC_INTERNAL_ONLY'||live.minInstances!==0))throw Error('Previous accepted baseline service privacy mismatch');
 }
 return {state,project:'vistavo-prod',baselineImage:closeBaselineImage,source:closeBaselinePaths.state,sourceSha256:sha(stateBytes),readySha256:sha(readyBytes),readbackSha256:sha(readbackBytes),acceptanceSha256:sha(acceptanceBytes),resources:closeResourceNames.map(name=>({name,uid:state.resources[name].uid}))};
}
