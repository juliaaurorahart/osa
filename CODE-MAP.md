# OSA — code map

This is a small guide to the parts we are actively shaping together. It is a React + TypeScript app: the browser runs it, and the code is checked by TypeScript before it is published.

```text
osa-gui-react-flow/
├── src/
│   ├── App.tsx          The living app: The Field, OSA, Project Frame, tools, boards, and interactions
│   ├── App.css          The visual language: colour, plants-and-light atmosphere, nodes, Field tools, responsive layout
│   ├── index.css        Global page-level defaults
│   ├── main.tsx         Starts React and mounts App.tsx into the browser page
│   └── cloudBoards.ts   Talks to the private-board service when private storage is enabled
├── functions/
│   └── api/             Cloudflare-side code for private boards and login checks
├── migrations/
│   └── 0001_boards.sql  The durable database shape for saved boards
├── public/              Small public assets, such as icons
├── package.json         The project’s tools and libraries, including React Flow
└── vite.config.ts       Development and build settings
```

## The parts you will see us change most

- **`src/App.tsx`** is the behaviour. A button, a new kind of object, what happens when a signal arrives, how a note becomes an OSA object—those live here.
- **`src/App.css`** is the feeling. The Field’s open landscape, the node view’s Gaia background, button shapes, spacing, readability, and phone layout live here.
- **`src/cloudBoards.ts`**, **`functions/api/`**, and **`migrations/`** are the private-storage path. They matter when a board needs to outlive one browser.

## A useful way to read a change

1. Find the visible part in `App.tsx`.
2. Find the handler it calls—usually a nearby function with a name like `addFieldItem` or `updateFieldItem`.
3. Find the matching class name in `App.css` to see how it is styled.

For example, **The Field** is mostly in `App.tsx` near `workspaceView === 'field'`; its visual surface is in `App.css` under `.field-workspace`, `.field-canvas`, and `.field-plane`.

The code is not sacred or fixed. It is the current readable version of an experiment, and we can keep changing the vocabulary, rules, and views as you discover what you need.
