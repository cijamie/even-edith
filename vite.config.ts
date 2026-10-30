import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths so the same build works inside the .ehpk
  // and under https://<user>.github.io/even-edith/.
  base: './',
  build: {
    target: 'es2022',
  },
})
