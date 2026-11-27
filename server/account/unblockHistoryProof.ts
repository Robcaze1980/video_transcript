import {type KeyObject,verify} from 'node:crypto';

export type UnblockHistoryTrust=Readonly<{
 realm:string;
 permitKey:KeyObject;
 receiptKey:KeyObject;
}>;

type Permit={
 realm:string;rootPath:string;ownerAccountId:string;identityKey:string;incidentId:string;
 attemptId:string;authorizationSha256:string;reviewRef:string;epoch:number;createdAtMs:number;
 identityVersion:string;incidentVersion:string;authorityVersion:string;guardVersion:string;
 activeIncidentVersion:string;
};

export function unblockPermitBytes(permit:Permit){
 return Buffer.from(JSON.stringify([
  'vistavo.account.unblock.permit.v1',permit.realm,permit.rootPath,
  permit.ownerAccountId,permit.identityKey,permit.incidentId,permit.attemptId,
  permit.authorizationSha256,permit.reviewRef,permit.epoch,permit.createdAtMs,
  permit.identityVersion,permit.incidentVersion,permit.authorityVersion,permit.guardVersion,
  permit.activeIncidentVersion,
 ]));
}

export function unblockReceiptBytes(permit:Permit,receipt:{
 receiptVersion:string;reviewedIncidentVersion:string;unblockedAtMs:number;
}){
 return Buffer.from(JSON.stringify([
  'vistavo.account.unblock.receipt.v1',unblockPermitBytes(permit).toString('base64url'),
  receipt.receiptVersion,receipt.reviewedIncidentVersion,receipt.unblockedAtMs,
 ]));
}

export function verifiesUnblockHistory(key:KeyObject,bytes:Buffer,signature:unknown){
 if(key.type!=='public'||key.asymmetricKeyType!=='ed25519'||
    typeof signature!=='string'||signature.length!==86)return false;
 const raw=Buffer.from(signature,'base64url');
 return raw.length===64&&raw.toString('base64url')===signature&&verify(null,bytes,key,raw);
}
