import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    manifest: true,
    outDir: 'dist/pilot-editor',
    rollupOptions: {
      input: {
        editor: 'server/commercial/web/pilotEditor.tsx',
        cloudCandidate: 'server/commercial/web/cloudCandidate.tsx',
        firebaseAuth: 'server/commercial/web/firebaseAuth.ts',
        publicAuth: 'server/commercial/web/publicAuth.ts',
        driveAuthorization: 'server/commercial/web/driveAuthorization.ts',
        accountUi: 'server/commercial/web/accountUi.ts',
        commercialLanding: 'server/commercial/web/commercialLanding.ts',
        isolatedCandidate: 'server/commercial/web/isolatedCandidate.tsx',
      },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: '[name].js' },
    },
  },
});
