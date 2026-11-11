import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';

// Prepared before the click so the popup stays directly associated with a user gesture.
export async function prepareDriveAuthorization(expectedUid: string) {
  const response = await fetch('/pilot/auth/config/');
  if (!response.ok) throw new Error('Google Drive no está configurado.');
  const { web, emulator } = await response.json();
  if (emulator) throw new Error('Drive requiere una cuenta Google real; no está disponible con el emulador.');
  const auth = getAuth(getApps().length ? getApp() : initializeApp(web));
  await auth.authStateReady();
  return async () => {
    const user = auth.currentUser;
    if (!user || user.uid !== expectedUid) throw new Error('Inicia sesión de nuevo en esta cuenta antes de conectar Drive.');
    if (!user.providerData.some(provider => provider.providerId === 'google.com')) {
      throw new Error('Conecta Google a tu cuenta antes de guardar en Drive. Puedes seguir descargando al dispositivo.');
    }
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result = await reauthenticateWithPopup(user, provider);
    if (result.user.uid !== expectedUid) throw new Error('La cuenta Google no coincide con tu sesión.');
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error('No se concedió el permiso para guardar en Drive.');
    return token;
  };
}
