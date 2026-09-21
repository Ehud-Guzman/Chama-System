import { defineConfig, loadEnv } from 'vite';
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

// A phone should be able to shake hands with the API while the bundle is still downloading.
//
// The first screen an admin sees is decided by an API call (is this session still good?), and a
// member's first lookup is one too. Both pay DNS, TCP and TLS to a different origin — around a third
// of a second on Kenyan mobile data — and every one of those milliseconds is on top of the app
// appearing. `preconnect` starts all three while the JavaScript is still arriving, so the request
// that matters leaves immediately.
//
// Cloudinary gets only a `dns-prefetch`: the group's logo and members' photos live there, but not on
// every page, and a full preconnect would open a TLS connection some visitors never use.
function preconnectOrigins(apiOrigin) {
  return {
    name: 'preconnect-origins',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const tags = [];
        if (apiOrigin) {
          tags.push(`<link rel="preconnect" href="${apiOrigin}" crossorigin>`);
        }
        tags.push('<link rel="dns-prefetch" href="https://res.cloudinary.com">');
        return html.replace('</head>', `  ${tags.join('\n  ')}\n  </head>`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // `loadEnv` rather than `process.env`: VITE_API_URL lives in .env, and the config runs before Vite
  // would otherwise hand it over.
  const env = loadEnv(mode, process.cwd(), '');
  let apiOrigin = '';
  try {
    // Same-origin would make this a wasted connection, so it is only added when the API is elsewhere.
    const url = env.VITE_API_URL ? new URL(env.VITE_API_URL) : null;
    if (url) apiOrigin = url.origin;
  } catch {
    // A malformed VITE_API_URL is the deploy's problem to report, not a reason to fail the build.
    apiOrigin = '';
  }

  return {
    plugins: [react(), tailwindcss(), preloadLatinFont(), preconnectOrigins(apiOrigin)],
    build: {
      rollupOptions: {
        output: {
          // React and the router change far less often than the app's own code. Splitting them means
          // a redeploy only invalidates the small page chunks instead of making every returning
          // member re-download the framework.
          //
          // There used to be a second manual chunk for axios. It is gone with the dependency: the
          // HTTP client is `fetch` now (services/api.js), 17.7 KB a visitor no longer downloads.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  };
});

