import {KeyObject,verify} from 'node:crypto';
import {types} from 'node:util';

export type UnblockHistoryTrust=Readonly<{
 realm:string;
 permitKey:KeyObject;
 receiptKey:KeyObject;
}>;

type Permit={
 realm:string;rootPath:string;ownerAccountId:string;identityKey:string;incidentId:string;
 unblockProtocol:number;attemptId:string;authorizationSha256:string;reviewRef:string;epoch:number;createdAtMs:number;
 identityVersion:string;incidentVersion:string;authorityVersion:string;guardVersion:string;
 activeIncidentVersion:string;
};

export function unblockPermitBytes(permit:Permit){
 return Buffer.from(JSON.stringify([
  'vistavo.account.unblock.permit.v2',permit.unblockProtocol,permit.realm,permit.rootPath,
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
  'vistavo.account.unblock.receipt.v2',unblockPermitBytes(permit).toString('base64url'),
  receipt.receiptVersion,receipt.reviewedIncidentVersion,receipt.unblockedAtMs,
 ]));
}

function isUnblockVerificationKey(key:unknown):key is KeyObject{
 return !types.isProxy(key)&&types.isKeyObject(key)&&key.type==='public'&&key.asymmetricKeyType==='ed25519';
}

export function readUnblockHistoryTrust(value:unknown):UnblockHistoryTrust|null{
 if(!value||typeof value!=='object'||types.isProxy(value))return null;
 const realm=Object.getOwnPropertyDescriptor(value,'realm')?.value;
 const permitKey=Object.getOwnPropertyDescriptor(value,'permitKey')?.value;
 const receiptKey=Object.getOwnPropertyDescriptor(value,'receiptKey')?.value;
 if(typeof realm!=='string'||!realm.trim()||!isUnblockVerificationKey(permitKey)||!isUnblockVerificationKey(receiptKey)||
    KeyObject.prototype.equals.call(permitKey,receiptKey))return null;
 return {realm,permitKey,receiptKey};
}

export function verifiesUnblockHistory(key:KeyObject,bytes:Buffer,signature:unknown){
 if(!isUnblockVerificationKey(key)||typeof signature!=='string'||signature.length!==86)return false;
 const raw=Buffer.from(signature,'base64url');
 return raw.length===64&&raw.toString('base64url')===signature&&verify(null,bytes,key,raw);
}
