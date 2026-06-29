import builtinModules from 'builtin-modules';
import esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isProd = process.argv.includes('production');

const VAULT_PLUGIN_DIR = path.resolve('test-vault/.obsidian/plugins/yggdrasil');

const plugins = [
  {
    name: 'copy-assets',
    setup(build) {
      build.onEnd(() => {
        const outfile = build.initialOptions.outfile || 'dist/main.js';
        const outdir = path.dirname(outfile);
        // Ensure output directory exists
        fs.mkdirSync(outdir, { recursive: true });
        // Symlink manifest.json to vault plugin dir (relative path)
        const manifestTarget = path.relative(VAULT_PLUGIN_DIR, path.resolve(outdir, 'manifest.json'));
        fs.rmSync(path.join(VAULT_PLUGIN_DIR, 'manifest.json'), { force: true });
        fs.symlinkSync(manifestTarget, path.join(VAULT_PLUGIN_DIR, 'manifest.json'), 'file');
        // Copy styles.css to dist/ if it exists
        const stylesPath = path.join('src', 'styles.css');
        if (fs.existsSync(stylesPath)) {
          fs.cpSync(stylesPath, path.join(outdir, 'styles.css'), { force: true });
          // Symlink styles.css to vault plugin dir (relative path)
          const stylesTarget = path.relative(VAULT_PLUGIN_DIR, path.resolve(outdir, 'styles.css'));
          fs.rmSync(path.join(VAULT_PLUGIN_DIR, 'styles.css'), { force: true });
          fs.symlinkSync(stylesTarget, path.join(VAULT_PLUGIN_DIR, 'styles.css'), 'file');
        }
        // Copy manifest.json to dist/ if it exists
        const manifestPath = path.join('manifest.json');
        if (fs.existsSync(manifestPath)) {
          fs.cpSync(manifestPath, path.join(outdir, 'manifest.json'), { force: true });
        }
      });
    },
  },
];

const commonOptions = {
  bundle: true,
  external: [
    'obsidian',
    ...builtinModules.filter((m) => !m.startsWith('node:')),
  ],
  platform: 'node',
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
  outfile: 'dist/main.js',
  format: 'cjs',
  target: 'es2022',
});

// Symlink main.js to vault plugin dir (relative path)
const mainTarget = path.relative(VAULT_PLUGIN_DIR, path.resolve('dist/main.js'));
fs.rmSync(path.join(VAULT_PLUGIN_DIR, 'main.js'), { force: true });
fs.symlinkSync(mainTarget, path.join(VAULT_PLUGIN_DIR, 'main.js'), 'file');

console.log(`✅ Build ${isProd ? 'production' : 'development'} complete`);
