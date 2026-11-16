/** Firestore may list indexes from sibling collections. Match the resource, not fields alone. */
export function indexFor(indexes,dbName,desired){
 const normalized=fields=>{const out=fields.map(v=>({fieldPath:v.fieldPath,...(v.order?{order:v.order}:{arrayConfig:v.arrayConfig})}));if(out.at(-1)?.fieldPath!=='__name__')out.push({fieldPath:'__name__',order:out.at(-1)?.order??'ASCENDING'});return out;};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 return (indexes??[]).find(v=>v.name?.startsWith(dbName+'/collectionGroups/'+desired.collectionGroup+'/indexes/')&&v.queryScope===desired.queryScope&&same(normalized(v.fields),normalized(desired.fields)));
}
