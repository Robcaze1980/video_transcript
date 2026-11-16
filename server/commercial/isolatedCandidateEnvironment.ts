const firestoreHost='127.0.0.1:8185';
const authHost='127.0.0.1:9099';

export function validateIsolatedCandidateEnvironment(env:NodeJS.ProcessEnv){
 if(env.VISTAVO_ISOLATED_CANDIDATE!=='1'||env.FIRESTORE_EMULATOR_HOST!==firestoreHost||env.FIREBASE_AUTH_EMULATOR_HOST!==authHost||env.GOOGLE_APPLICATION_CREDENTIALS||env.VISTAVO_PROJECT_ID||env.VISTAVO_ACCOUNT_MODE||env.GCLOUD_PROJECT||env.GOOGLE_CLOUD_PROJECT||env.FIREBASE_CONFIG)throw Error('Isolated emulators required');
}
