/** Read-only rollout barrier. Operator keeps the candidate paused; this is not a distributed lock. */
export async function assertDeploymentQuiescent({project,root,image,phase,required,record}){
 if(project!=='vistavo-prod'||root!=='vistavo/candidate-v1'||!['before-runtime-update','after-api-before-maintenance'].includes(phase))throw Error('Existing quiescence resource boundary');
 const url=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${root}:runQuery`;
 const pendingQuery=collectionId=>({structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:'state'},op:'EQUAL',value:{stringValue:'pending'}}},limit:1}});
 const statesQuery=(collectionId,states)=>({structuredQuery:{from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:'state'},op:'IN',value:{arrayValue:{values:states.map(stringValue=>({stringValue}))}}}},limit:1}});
 const pending=await required(url,'POST',pendingQuery('outbox'),'quiescent-all-pending-'+phase);
 const filePending=await required(url,'POST',pendingQuery('fileOutbox'),'quiescent-file-pending-'+phase);
 const active=await required(url,'POST',statesQuery('jobs',['queued','running','unknown']),'quiescent-active-'+phase);
 const artifactWork=await required(url,'POST',statesQuery('artifacts',['pending','staged','purging']),'quiescent-artifacts-'+phase);
 const uploadWork=await required(url,'POST',statesQuery('uploads',['uploading','queued','verifying','cleaning','deleting']),'quiescent-uploads-'+phase);
 if(![pending,filePending,active,artifactWork,uploadWork].every(Array.isArray))throw Error('Existing quiescence readback unavailable');
 const event={at:new Date().toISOString(),phase,image,pendingFound:pending.some(row=>row.document),filePendingFound:filePending.some(row=>row.document),activeFound:active.some(row=>row.document),artifactWorkFound:artifactWork.some(row=>row.document),uploadWorkFound:uploadWork.some(row=>row.document),operatorQuiescenceRequired:true};
 await record(event);
 if(event.pendingFound||event.filePendingFound||event.activeFound||event.artifactWorkFound||event.uploadWorkFound)throw Error('Existing candidate work blocks rollout; inspect without changing money');
 return event;
}
