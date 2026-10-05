import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],base:'./',build:{rollupOptions:{output:{manualChunks(id){if(id.includes('node_modules')){if(id.includes('@supabase'))return 'supabase';if(id.includes('motion'))return 'motion';if(id.includes('/react')||id.includes('/scheduler'))return 'react';}}}}},test:{environment:'node',include:['src/**/*.test.ts']}});
