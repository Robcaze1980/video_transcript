import{project,network,resources as bodies}from'./resources.mjs';
export const compatible={
 network:d=>d.name===bodies.network.name&&d.autoCreateSubnetworks===false&&d.description===bodies.network.description&&d.routingConfig?.routingMode==='REGIONAL',
 subnet:d=>d.name===bodies.subnet.name&&d.description===bodies.subnet.description&&d.ipCidrRange===bodies.subnet.ipCidrRange&&d.network?.endsWith('/'+network)&&d.privateIpGoogleAccess===true,
 peering:d=>d.name===bodies.peeringAddress.name&&d.addressType==='INTERNAL'&&d.purpose==='VPC_PEERING'&&d.address==='10.41.0.0'&&d.prefixLength===16&&d.network?.endsWith('/'+network),
 bucket:(name,d)=>{const body=bodies[name];return d.name===body.name&&String(d.projectNumber)==='107404655346'&&d.labels?.app==='vistavo'&&d.labels?.environment==='candidate'&&d.storageClass==='STANDARD'&&d.location==='US-CENTRAL1'&&d.iamConfiguration?.uniformBucketLevelAccess?.enabled===true&&d.iamConfiguration?.publicAccessPrevention==='enforced'&&(name!=='media'||(String(d.softDeletePolicy?.retentionDurationSeconds??0)==='0'&&d.versioning?.enabled!==true))&&(name!=='builds'||(d.lifecycle?.rule?.length===1&&d.lifecycle.rule[0].action?.type==='Delete'&&Object.keys(d.lifecycle.rule[0].action).length===1&&d.lifecycle.rule[0].condition?.age===7&&Object.keys(d.lifecycle.rule[0].condition).length===1));},
 artifact:d=>d.name==='projects/'+project+'/locations/us-central1/repositories/vistavo'&&d.format==='DOCKER'&&d.labels?.app==='vistavo'&&d.labels?.environment==='candidate'&&d.description===bodies.artifact.description&&(!d.mode||d.mode==='STANDARD_REPOSITORY'),
 identity:(accountId,d)=>d.email===accountId+'@'+project+'.iam.gserviceaccount.com'&&d.projectId===project&&d.description==='Vistavo dedicated '+accountId+' candidate identity'&&d.displayName===accountId&&d.disabled!==true,
};
export function psaConnection(response){
 if(response.nextPageToken)throw Error('Unexpected PSA pagination');
 const list=response.connections??[];
 if(list.length>1)throw Error('Unexpected multiple PSA connections');
 const matching=list.find(c=>[network,network.replace(project,'107404655346')].some(n=>c.network===n||c.network?.endsWith('/'+n)));
 if(list.length&&!matching)throw Error('Unexpected PSA network representation');
 if(matching&&(matching.reservedPeeringRanges?.length!==1||matching.reservedPeeringRanges[0]!=='vistavo-sql-private'))throw Error('Incompatible PSA range');
 return matching;
}
export function assertPrivatePolicy(policy){for(const binding of policy.bindings??[])if(binding.members?.some(m=>m==='allUsers'||m==='allAuthenticatedUsers'))throw Error('Unexpected public IAM binding');}
