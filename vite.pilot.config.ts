import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Candidate mode (`--mode candidate`) swaps only the reviewed-translation feature switch to true. The default
// build, and therefore production, keeps it false (server/commercial/web/reviewedTranslationFeature.ts).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    ...(mode === 'candidate' ? [{
      name: 'reviewed-translation-candidate-switch',
      enforce: 'pre' as const,
      resolveId(source: string) {
        return /^\.\/reviewedTranslationFeature$/.test(source) ? resolve(__dirname, 'server/commercial/web/reviewedTranslationFeature.candidate.ts') : null;
      },
    }] : []),
  ],
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
}));
