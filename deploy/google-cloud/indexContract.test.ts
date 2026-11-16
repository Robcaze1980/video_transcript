import {expect,it} from 'vitest';import {indexFor} from './indexContract.mjs';
it('does not accept a READY sibling outbox index for a missing fileOutbox index',()=>{
 const db='projects/vistavo-prod/databases/(default)',fields=[{fieldPath:'state',order:'ASCENDING'},{fieldPath:'nextAttemptAt',order:'ASCENDING'}],desired={collectionGroup:'fileOutbox',queryScope:'COLLECTION',fields};
 const sibling={name:db+'/collectionGroups/outbox/indexes/ready',queryScope:'COLLECTION',state:'READY',fields:[...fields,{fieldPath:'__name__',order:'ASCENDING'}]};
 expect(indexFor([sibling],db,desired)).toBeUndefined();
 const own={...sibling,name:db+'/collectionGroups/fileOutbox/indexes/new'};
 expect(indexFor([sibling,own],db,desired)).toBe(own);
 expect(indexFor([{...own,queryScope:'COLLECTION_GROUP'}],db,desired)).toBeUndefined();
 expect(indexFor([{...own,name:db+'/collectionGroups/fileOutboxExtra/indexes/wrong'}],db,desired)).toBeUndefined();
});
