import esbuild from 'esbuild';
import builtinModules from 'builtin-modules';
import * as fs from 'fs';
import * as path from 'path';

const isProd = process.argv.includes('production');

const plugins = [
  {
    name: 'copy-assets',
    setup(build) {
      build.onEnd(() => {
        const outfile = build.initialOptions.outfile || 'dist/main.js';
        const outdir = path.dirname(outfile);
        // Ensure output directory exists
        fs.mkdirSync(outdir, { recursive: true });
        // Copy manifest.json
        fs.copyFileSync(
          'manifest.json',
          path.join(outdir, 'manifest.json')
        );
        // Copy styles.css if it exists
        const stylesPath = path.join('src', 'styles.css');
        if (fs.existsSync(stylesPath)) {
          fs.copyFileSync(
            stylesPath,
            path.join(outdir, 'styles.css')
          );
        }
      });
    },
  },
];

const commonOptions = {
  bundle: true,
  external: ['obsidian', ...builtinModules.filter((m) => !m.startsWith('node:'))],
  platform: 'browser',
  sourcemap: isProd ? false : 'inline',
  minify: isProd,
  treeShaking: true,
  plugins,
  define: {
    'process.env.NODE_ENV': isProd ? '"production"' : '"development"',
  },
};

// Build the main plugin entry
await esbuild.build({
  ...commonOptions,
  entryPoints: ['src/main.ts'],
  outfile: isProd ? 'main.js' : 'dist/main.js',
  format: 'cjs',
  target: 'es2022',
});

console.log(`✅ Build ${isProd ? 'production' : 'development'} complete`);
