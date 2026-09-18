import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Preload the one font file that actually loads in Kenya.
//
// @fontsource/archivo splits the face into three subsets and only the latin one is
// fetched (the others are excluded by `unicode-range`), but browsers discover fonts
// from CSS — after the stylesheet has parsed, which is after the layout was painted
// with a fallback. Reading the hashed filename out of the bundle lets the page fetch
// it in parallel with the JavaScript. `crossorigin` is required for fonts.
function preloadLatinFont() {
  return {
    name: 'preload-latin-font',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle || {};
        const latin = Object.keys(bundle).find((file) =>
          /archivo-latin-wght-normal-.*\.woff2$/.test(file)
        );
        if (!latin) return html;
        const tag = `<link rel="preload" as="font" type="font/woff2" crossorigin href="/${latin}">`;
        return html.replace('</head>', `  ${tag}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadLatinFont()],
  build: {
    rollupOptions: {
      output: {
        // React and the HTTP client change far less often than the app's own code.
        // Splitting them means a redeploy only invalidates the small page chunks
        // instead of making every returning member re-download the framework.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          vendor: ['axios'],
        },
      },
    },
  },
});

