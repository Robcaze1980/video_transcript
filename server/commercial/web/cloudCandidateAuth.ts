import {initializeApp} from 'firebase/app';
import {getAuth,setPersistence,inMemoryPersistence,GoogleAuthProvider,signInWithPopup,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendEmailVerification,sendPasswordResetEmail,reload,onIdTokenChanged,signOut,type User} from 'firebase/auth';
import {publicConfig} from './cloudCandidateApi';
export async function candidateAuth(){
 const config=await publicConfig(),auth=getAuth(initializeApp(config.web,'vistavo-local-candidate'));await setPersistence(auth,inMemoryPersistence);auth.languageCode='es';
 return {config,
  observe:(callback:(user:User|null)=>void)=>onIdTokenChanged(auth,callback),
  google:()=>signInWithPopup(auth,new GoogleAuthProvider()),
  email:(email:string,password:string)=>signInWithEmailAndPassword(auth,email,password),
  async register(email:string,password:string){const result=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(result.user);return result;},
  async verify(){if(auth.currentUser)await sendEmailVerification(auth.currentUser);},
  async refresh(){if(auth.currentUser){await reload(auth.currentUser);await auth.currentUser.getIdToken(true);}return auth.currentUser;},
  async reset(email:string){try{await sendPasswordResetEmail(auth,email);}catch{/* Same notice regardless of whether the email exists. */}},
  token:async(uid:string)=>{if(auth.currentUser?.uid!==uid)throw Error('signed_out');const token=await auth.currentUser.getIdToken();if(auth.currentUser?.uid!==uid)throw Error('signed_out');return token;},
  logout:()=>signOut(auth),
 };
}
export type CandidateAuth=Awaited<ReturnType<typeof candidateAuth>>;
