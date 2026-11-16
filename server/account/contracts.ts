/** Public account DTOs; no provider, candidate ledger or credential dependencies. */
export type ProjectKind = 'srt' | 'text';
export type ProjectSummary = {id:string;title:string;kind:ProjectKind;revision:number;createdAtMs:number;updatedAtMs:number};
export type AccountProject = ProjectSummary & {content:string};
export type Services = {manualSubtitles:true;transcription:false;translation:false;narration:false;payments:false};
export type AccountView = {
 id:string;
 balance:{unit:'video_seconds';credited:number;available:number;reserved:number;consumed:number;active:number};
 limits:{projectBytes:number;projectCount:number;titleCharacters:number};
 services:Services;
};
export type ProjectPage = {items:ProjectSummary[];nextCursor:string|null};
export type LedgerPage = {items:Array<{id:string;createdAtMs:number;seconds:number;kind:string}>;nextCursor:string|null};
