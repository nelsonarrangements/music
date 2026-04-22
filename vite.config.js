import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// HTML partials plugin: resolves <!-- include: path --> recursively
function htmlPartialsPlugin() {
  function resolveIncludes(html) {
    const pattern = /<!--\s*include:\s*(.+?)\s*-->/g
    if (!pattern.test(html)) return html
    // Reset lastIndex after test()
    return html.replace(/<!--\s*include:\s*(.+?)\s*-->/g, (_, file) => {
      try {
        const content = readFileSync(resolve(__dirname, file.trim()), 'utf-8')
        return resolveIncludes(content) // recurse for nested includes
      } catch {
        return `<!-- partial not found: ${file} -->`
      }
    })
  }

  return {
    name: 'html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return resolveIncludes(html)
      }
    }
  }
}

export default defineConfig({
  base: '/',
  plugins: [htmlPartialsPlugin()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main:              resolve(__dirname, 'index.html'),
        about:             resolve(__dirname, 'about.html'),
        arrangements:      resolve(__dirname, 'arrangements.html'),
        sheetMusic:        resolve(__dirname, 'sheet-music.html'),
        learn:             resolve(__dirname, 'learn.html'),
        registrationBasics:  resolve(__dirname, 'registration-basics.html'),
        creativeHymnPlaying: resolve(__dirname, 'creative-hymn-playing.html'),
        pistonlink:          resolve(__dirname, 'pistonlink.html'),
      }
    }
  }
})
