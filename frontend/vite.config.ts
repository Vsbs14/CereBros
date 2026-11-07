import {defineConfig} from 'vite';

// Relative assets work on both a repository Pages URL and the local Python server.
export default defineConfig({base:'./',server:{host:'127.0.0.1',port:5173,strictPort:true}});
