import { useEffect, useRef } from 'react'
import './LabAbout.css'

type LabAboutProps = {
  onBack: () => void
}

type ArtCredit = {
  file: string
  work: string
  creator: string
  creditLine?: string
  note?: string
  source: string
  license?: {
    name: string
    url: string
  }
}

const REPOSITORY_URL = 'https://github.com/juliaaurorahart/osa'
const PUBLIC_DOMAIN_LICENSE = {
  name: 'CC0 / Public Domain',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
}
const PEXELS_LICENSE = {
  name: 'Pexels License',
  url: 'https://www.pexels.com/license/',
}

const ART_CREDITS: ArtCredit[] = [
  {
    file: 'blue-purple-watercolor-splatter.jpg',
    work: 'Blue Purple Watercolor Splatter',
    creator: 'Circe Denyer',
    source: 'https://www.publicdomainpictures.net/en/view-image.php?image=262083&picture=blue-purple-watercolor-splatter',
  },
  {
    file: 'purple-watercolor-texture.jpg',
    work: 'Abstract Background Watercolor',
    creator: 'Karen Arnold',
    source: 'https://www.publicdomainpictures.net/en/view-image.php?image=415144&picture=abstract-background-watercolor',
  },
  {
    file: 'gouache-wash.jpg',
    work: 'Beauty & Truth 12',
    creator: 'Fons Heijnsbroek',
    note: 'Resized local derivative.',
    source: 'https://commons.wikimedia.org/wiki/File:%27Beauty_%26_Truth_12._%28on_Fr._von_Schiller%29%27_-_gouache_painting_on_paper_-_abstract_expressionism_art%2C_made_in_2007_by_Dutch_painter_artist_Fons_Heijnsbroek.jpg',
  },
  {
    file: 'wall-paint-drips.jpg',
    work: 'Splattered paint on wall',
    creator: 'Patrick Tomasso',
    note: 'Resized local derivative.',
    source: 'https://commons.wikimedia.org/wiki/File:Splattered_paint_on_wall_(Unsplash).jpg',
  },
  {
    file: 'table-paint-splatter.jpg',
    work: 'Splatter paint on white table',
    creator: 'Ricardo Viana',
    note: 'Resized local derivative.',
    source: 'https://commons.wikimedia.org/wiki/File:Splatter_paint_on_white_table_(Unsplash).jpg',
  },
  {
    file: 'pink-ink-in-water.jpg',
    work: 'Colorful Liquids Mixed in Water',
    creator: 'MART PRODUCTION',
    note: 'Resized provider preview; displayed with CSS cropping, masking, and contrast treatment.',
    source: 'https://www.pexels.com/photo/colorful-liquids-mixed-in-water-7577864/',
    license: PEXELS_LICENSE,
  },
  {
    file: 'blue-pink-ink-in-water.jpg',
    work: 'High-Speed Photography of Colorful Ink Diffusion in Water',
    creator: 'cottonbro studio',
    note: 'Resized provider preview; displayed with CSS cropping, masking, and contrast treatment.',
    source: 'https://www.pexels.com/photo/high-speed-photography-of-colorful-ink-diffusion-in-water-9669091/',
    license: PEXELS_LICENSE,
  },
  {
    file: 'paint-splatter-mask.svg',
    work: 'Splat',
    creator: 'liftarn',
    source: 'https://openclipart.org/detail/201843/splat',
  },
  {
    file: 'paint-smear-mask.svg',
    work: 'Paint smear',
    creator: 'liftarn and Jonny Doomsday',
    note: "Uploaded by liftarn and derived from Jonny Doomsday's Vector Pack 8.",
    source: 'https://openclipart.org/detail/213832/paint-smear',
  },
  {
    file: 'paint-dry-brush-mask.png',
    work: 'Brush stroke',
    creator: 'liftarn and Jonny Doomsday',
    note: "Rasterized locally; uploaded by liftarn and derived from Jonny Doomsday's Vector Pack 8.",
    source: 'https://openclipart.org/detail/213817/brush-stroke',
  },
  {
    file: 'paint-round-splat-mask.svg',
    work: 'Splat (#2)',
    creator: 'creator not identified',
    creditLine: 'Creator not identified; uploaded by oksmith.',
    source: 'https://openclipart.org/detail/301591/splat-2',
  },
  {
    file: 'paint-splash-mask.svg',
    work: 'Splash',
    creator: 'dominiquechappard',
    source: 'https://openclipart.org/detail/37219/splash',
  },
]

const SOFTWARE_GROUPS = [
  {
    name: 'Interface and app foundation',
    packages: [
      'react',
      'react-dom',
      'react-markdown',
      '@xyflow/react',
      '@cloudflare/pages-plugin-cloudflare-access',
    ],
  },
  {
    name: 'Drawing and creative canvases',
    packages: [
      '@excalidraw/excalidraw',
      'fabric',
      'konva',
      'react-konva',
      'paper',
      'perfect-freehand',
      'p5',
      'pixi.js',
      'three',
    ],
  },
  {
    name: 'Diagrams and data visualization',
    packages: ['mermaid', 'vega', 'vega-lite', 'vega-embed'],
  },
  {
    name: 'Code editing',
    packages: [
      'codemirror',
      '@codemirror/lang-javascript',
      '@codemirror/theme-one-dark',
      '@uiw/react-codemirror',
    ],
  },
  {
    name: 'Development toolchain',
    packages: [
      'typescript',
      'vite',
      '@vitejs/plugin-react',
      '@babel/core',
      '@rolldown/plugin-babel',
      'babel-plugin-react-compiler',
      'eslint',
      '@eslint/js',
      'typescript-eslint',
      'eslint-plugin-react-hooks',
      'eslint-plugin-react-refresh',
      'globals',
      '@types/babel__core',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      '@types/three',
    ],
  },
] as const

function repositoryFileUrl(path: string) {
  return `${REPOSITORY_URL}/blob/main/${path}`
}

/** Licensing, acknowledgements, authorship, and development transparency for OSA Lab. */
export function LabAbout({ onBack }: LabAboutProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <article className="lab-about" aria-labelledby="lab-about-title">
      <header className="lab-about__hero">
        <button type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to Settings
        </button>
        <p>About</p>
        <h2 id="lab-about-title" ref={headingRef} tabIndex={-1}>About OSA Lab</h2>
        <span>
          Who made it, what helped make it, and where to inspect the work.
        </span>
      </header>

      <div className="lab-about__layout">
        <section className="lab-about__section lab-about__section--wide" aria-labelledby="lab-about-made">
          <p className="lab-about__kicker">Development transparency</p>
          <h3 id="lab-about-made">How this was made</h3>
          <div className="lab-about__statement">
            <p>
              Julia directed the goals, chose the product and design direction, made the decisions, and remains responsible for OSA Lab and what it ships.
            </p>
            <p>
              OpenAI&apos;s ChatGPT and Codex were used as collaborative tools to brainstorm, explore designs, write and edit code and copy, research license information, and run or help run tests. Their output can be incomplete or wrong, so it was treated as material to review—not as an independent author, decision-maker, or guarantee.
            </p>
          </div>
        </section>

        <section className="lab-about__section" aria-labelledby="lab-about-license">
          <p className="lab-about__kicker">Licensing</p>
          <h3 id="lab-about-license">Project and third-party terms</h3>
          <p>
            This checkout does not currently contain a project-level <code>LICENSE</code> or <code>COPYING</code> file. This page therefore does not grant permission to copy, modify, or distribute OSA&apos;s own source or content. Ask the repository owner unless an explicit project license is added.
          </p>
          <p>
            Third-party software and artwork remain under their own terms. The acknowledgements below are practical pointers, not a replacement for the original license texts and not an exhaustive legal-notices report.
          </p>
        </section>

        <section className="lab-about__section" aria-labelledby="lab-about-inspect">
          <p className="lab-about__kicker">Open development</p>
          <h3 id="lab-about-inspect">Inspect the source and history</h3>
          <p>
            The code, source ledger, dependency manifests, and change history can be inspected directly. In a local checkout, the same material is available at the paths shown below.
          </p>
          <ul className="lab-about__source-list">
            <li>
              <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">Source repository</a>
              <code>repository root</code>
            </li>
            <li>
              <a href={repositoryFileUrl('README.md')} target="_blank" rel="noreferrer">Project overview</a>
              <code>README.md</code>
            </li>
            <li>
              <a href={repositoryFileUrl('src/lab/LabAbout.tsx')} target="_blank" rel="noreferrer">This About page</a>
              <code>src/lab/LabAbout.tsx</code>
            </li>
            <li>
              <a href={repositoryFileUrl('src/lab/assets/SOURCES.md')} target="_blank" rel="noreferrer">Paint source ledger</a>
              <code>src/lab/assets/SOURCES.md</code>
            </li>
            <li>
              <a href={repositoryFileUrl('package.json')} target="_blank" rel="noreferrer">Direct dependencies</a>
              <code>package.json</code>
            </li>
            <li>
              <a href={repositoryFileUrl('package-lock.json')} target="_blank" rel="noreferrer">Resolved dependency tree</a>
              <code>package-lock.json</code>
            </li>
            <li>
              <a href={`${REPOSITORY_URL}/commits/main`} target="_blank" rel="noreferrer">Commit history</a>
              <code>git log</code>
            </li>
          </ul>
        </section>

        <section className="lab-about__section lab-about__section--wide" aria-labelledby="lab-about-art">
          <p className="lab-about__kicker">Human-created art</p>
          <h3 id="lab-about-art">Paint and texture credits</h3>
          <p>
            The Lab landing surface uses local copies or derivatives of the works below. Each work retains its own license: the paint textures and masks are CC0 / Public Domain, while the ink-in-water photographs use the Pexels License. Credits preserve the creators and provenance behind the visuals.
          </p>
          <p>
            The raised, glossy paint lighting is an SVG/CSS treatment of the credited masks—not an additional photograph or AI-generated raster artwork. Cropping, tinting, masking, and contrast adjustments also shape how the source images appear here.
          </p>
          <ul className="lab-about__credit-grid">
            {ART_CREDITS.map((credit) => (
              <li key={credit.file}>
                <a href={credit.source} target="_blank" rel="noreferrer">{credit.work}</a>
                <span>{credit.creditLine ?? `by ${credit.creator}`}</span>
                <small>
                  <a href={(credit.license ?? PUBLIC_DOMAIN_LICENSE).url} target="_blank" rel="noreferrer">
                    {(credit.license ?? PUBLIC_DOMAIN_LICENSE).name}
                  </a>
                </small>
                {credit.note ? <small>{credit.note}</small> : null}
                <code>{credit.file}</code>
              </li>
            ))}
          </ul>
          <p className="lab-about__fine-print">
            See the{' '}
            <a href={repositoryFileUrl('src/lab/assets/SOURCES.md')} target="_blank" rel="noreferrer">full source ledger</a>
            {' '}and the <a href="https://openclipart.org/share" target="_blank" rel="noreferrer">Openclipart license statement</a>.
          </p>
        </section>

        <section className="lab-about__section lab-about__section--wide" aria-labelledby="lab-about-software">
          <p className="lab-about__kicker">Software acknowledgements</p>
          <h3 id="lab-about-software">Direct libraries and tools</h3>
          <p>
            OSA Lab is built with the following direct runtime and development packages declared in <code>package.json</code>. Each project&apos;s linked package page points toward its maintainers, source, and license information.
          </p>
          <div className="lab-about__software-groups">
            {SOFTWARE_GROUPS.map((group) => (
              <section key={group.name}>
                <h4>{group.name}</h4>
                <ul>
                  {group.packages.map((packageName) => (
                    <li key={packageName}>
                      <a href={`https://www.npmjs.com/package/${packageName}`} target="_blank" rel="noreferrer">
                        {packageName}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="lab-about__fine-print">
            For the exact installed versions and transitive packages, inspect <a href={repositoryFileUrl('package-lock.json')} target="_blank" rel="noreferrer">package-lock.json</a>. That file is a dependency record, not a compiled notices document.
          </p>
          <h4>Klecks painting editor</h4>
          <p>
            <a href="https://github.com/bitbof/klecks" target="_blank" rel="noreferrer">Klecks by bitbof and contributors</a> is a separately bundled, MIT-licensed painting editor. OSA serves a pinned build locally within the Lab; opening it does not send your artwork to the Klecks website. Its source revision, build instructions, and bundled license notices are kept with the editor in <code>public/lab-vendor/klecks</code>.
          </p>
        </section>
      </div>
    </article>
  )
}
