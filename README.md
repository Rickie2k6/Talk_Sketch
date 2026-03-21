# Talk Sketch

Talk Sketch is a whiteboard-style math assistant built with React, Excalidraw, Express, OpenAI, and CoMER.

It lets you:

- draw handwritten math on the board
- recognize expressions with the local CoMER model
- ask the chat assistant questions about the current sketch
- use speech input for the chat box

## Stack

- Frontend: React + Vite + Excalidraw
- Backend: Express
- Math recognition: CoMER checkpoint running in a Python worker
- Chat: OpenAI API

## Project Layout

```text
src/                  React app
scripts/              helper scripts and the CoMER worker
server.js             Express API for chat and recognition
comer/                CoMER model code
lightning_logs/       bundled CoMER checkpoints
example/              sample handwritten math assets
```

## Run

Open two terminals from the project root.

Terminal 1:

```bash
npm run start:server
```

Terminal 2:

```bash
npm run dev
```

Then open `http://127.0.0.1:5174`.

## Deploy On A Remote Server

For a Linux server such as Wukong, use the production flow so Express serves the built frontend and API from one port.

1. Install dependencies and make sure the Python environment for CoMER is available.
2. Build the frontend:

```bash
npm install
npm run build
```

3. Start the app in production mode on a network-accessible host:

```bash
HOST=0.0.0.0 PORT=3001 COMER_PYTHON_BIN=/path/to/python npm run serve:prod
```

4. Open `http://<server-hostname>:3001`.

Useful environment variables:

- `HOST`: bind address for the Express server, for example `0.0.0.0`
- `PORT`: backend and production web port
- `COMER_PYTHON_BIN`: Python binary with the CoMER dependencies installed
- `COMER_CHECKPOINT`: optional path to a specific checkpoint file. If omitted, the app automatically picks the checkpoint with the highest `val_ExpRate` from `lightning_logs/version_*/checkpoints/`
- `COMER_DEVICE`: optional inference device such as `cpu`, `cuda`, or `mps`
- `VITE_HOST`, `VITE_PORT`, `VITE_BACKEND_URL`: dev-mode overrides for remote Vite usage

## Notes

- `npm run start:server` automatically resolves the `talk_sketch` conda environment for CoMER if it exists.
- The first recognition request is slower because the model checkpoint has to load into memory.
- Chat responses still require an OpenAI API key in the app UI.

## Useful Commands

```bash
npm run dev
npm run build
npm run clean
npm run start:server
npm run serve:prod
```
