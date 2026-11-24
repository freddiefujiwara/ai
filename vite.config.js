import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: '/muse/',
  test: {
    environment: 'jsdom'
  }
});
