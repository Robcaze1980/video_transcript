import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/pilot-editor',
    rollupOptions: {
      input: {
        editor: 'server/commercial/web/pilotEditor.tsx',
        firebaseAuth: 'server/commercial/web/firebaseAuth.ts',
        driveAuthorization: 'server/commercial/web/driveAuthorization.ts',
        accountUi: 'server/commercial/web/accountUi.ts',
        commercialLanding: 'server/commercial/web/commercialLanding.ts',
      },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: '[name].js' },
    },
  },
});
