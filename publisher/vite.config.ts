import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({
  root:resolve(process.cwd(),'publisher'),
  clearScreen:false,
  server:{host:'127.0.0.1',port:1421,strictPort:true},
  build:{outDir:resolve(process.cwd(),'publisher-dist'),emptyOutDir:true,target:'es2022'}
});
