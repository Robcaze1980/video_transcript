// REST bodies for a private candidate; passwords and auth tokens are never part of this module.
export const project='vistavo-prod';
export const region='us-central1';
export const network='projects/vistavo-prod/global/networks/vistavo-private';
const labels={app:'vistavo',environment:'candidate'};
export const resources={
 network:{name:'vistavo-private',description:'Vistavo dedicated candidate network',autoCreateSubnetworks:false,routingConfig:{routingMode:'REGIONAL'}},
 subnet:{name:'vistavo-us-central1',description:'Vistavo dedicated candidate subnet',network,ipCidrRange:'10.40.0.0/24',privateIpGoogleAccess:true},
 peeringAddress:{name:'vistavo-sql-private',description:'Vistavo private service access',addressType:'INTERNAL',purpose:'VPC_PEERING',address:'10.41.0.0',prefixLength:16,network},
 connection:{network,reservedPeeringRanges:['vistavo-sql-private']},
 sql:{name:'vistavo-postgres',databaseVersion:'POSTGRES_17',region,settings:{tier:'db-g1-small',edition:'ENTERPRISE',availabilityType:'ZONAL',activationPolicy:'ALWAYS',dataDiskType:'PD_SSD',dataDiskSizeGb:'10',storageAutoResize:true,storageAutoResizeLimit:'20',deletionProtectionEnabled:true,ipConfiguration:{ipv4Enabled:false,privateNetwork:network,allocatedIpRange:'vistavo-sql-private',sslMode:'ENCRYPTED_ONLY'},databaseFlags:[{name:'cloudsql.iam_authentication',value:'on'}],backupConfiguration:{enabled:true,startTime:'08:00',pointInTimeRecoveryEnabled:true,transactionLogRetentionDays:7,backupRetentionSettings:{retainedBackups:7,retentionUnit:'COUNT'}},userLabels:labels}},
 media:{name:'vistavo-prod-107404655346-media',location:'US-CENTRAL1',storageClass:'STANDARD',labels,iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'},versioning:{enabled:false},softDeletePolicy:{retentionDurationSeconds:'0'}},
 builds:{name:'vistavo-prod-107404655346-builds',location:'US-CENTRAL1',storageClass:'STANDARD',labels,iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'},lifecycle:{rule:[{action:{type:'Delete'},condition:{age:7}}]}},
 artifact:{format:'DOCKER',description:'Vistavo dedicated private candidate images',labels},
 secret:{labels:{...labels,sql:'vistavo-postgres'},replication:{userManaged:{replicas:[{location:region}]}}}
};

export function serviceAccountBody(accountId){if(!['vistavo-runtime','vistavo-bootstrap','vistavo-builder'].includes(accountId))throw Error('Unexpected identity');return{accountId,serviceAccount:{displayName:accountId,description:'Vistavo dedicated '+accountId+' candidate identity'}};}
