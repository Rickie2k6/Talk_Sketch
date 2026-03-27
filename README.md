# Talk Sketch

Talk Sketch is a whiteboard-style math assistant built with React, Excalidraw, Express, OpenAI, and CoMER.

It lets you:

- draw handwritten math on the board
- recognize expressions with CoMER (v0) formula recognition
- ask the chat assistant questions about the current sketch
- use speech input for the chat box

## Stack

- Frontend: React + Vite + Excalidraw
- Backend: Express
- Math recognition: CoMER (v0) PyTorch Lightning model running in a Python worker
- Chat: OpenAI API

## Project Layout

```text
src/                  React app
scripts/              helper scripts and the CoMER worker
server.js             Express API for chat and recognition
CoMER/                CoMER model checkpoint and PyTorch Lightning code
example/              sample handwritten math assets
```

## Install

JavaScript dependencies:

```bash
npm install
```

Python dependencies:

```bash
pip install -r requirements.txt
```

## Run In Dev

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

```bash
npm install
npm run build
HOST=0.0.0.0 PORT=3001 COMER_PYTHON_BIN=/path/to/python npm run serve:prod
```

Then open `http://<server-hostname>:3001`.

Useful environment variables:

- `HOST`: bind address for the Express server, for example `0.0.0.0`
- `PORT`: backend and production web port
- `COMER_PYTHON_BIN`: Python binary with the CoMER dependencies installed, default `python3`
- `COMER_MODEL_PATH`: path to CoMER model checkpoint, default `CoMER/lightning_logs/version_0/checkpoints/epoch=151-step=57151-val_ExpRate=0.6365.ckpt`
- `COMER_DEVICE`: inference device such as `cpu`, `cuda`, or `mps`, default `cpu`
- `NODE_ENV`: set to `production` for production mode, `development` for dev mode
- `VITE_HOST`, `VITE_PORT`, `VITE_BACKEND_URL`: dev-mode overrides for remote Vite usage

## Notes

- `npm run start:server` automatically resolves the `talk_sketch` conda environment if it exists.
- The first recognition request is slower because the CoMER model needs to load (~2-5 seconds on first startup).
- Subsequent recognition requests are faster (~500ms-1s) and can be even faster if cached (~10ms).
- Chat responses still require an OpenAI API key in the app UI.
- For GPU acceleration, install PyTorch with CUDA support and set `COMER_DEVICE=cuda`.

## Useful Commands

```bash
npm run dev
npm run build
npm run clean
npm run start:server
npm run serve:prod
```
