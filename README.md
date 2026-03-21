# Talk Sketch

Talk Sketch is a whiteboard-style math assistant built with React, Excalidraw, Express, OpenAI, and Pix2Text.

It lets you:

- draw handwritten math on the board
- recognize expressions with Pix2Text formula OCR
- ask the chat assistant questions about the current sketch
- use speech input for the chat box

## Stack

- Frontend: React + Vite + Excalidraw
- Backend: Express
- Math recognition: Pix2Text running in a Python worker
- Chat: OpenAI API

## Project Layout

```text
src/                  React app
scripts/              helper scripts and the Pix2Text worker
server.js             Express API for chat and recognition
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
HOST=0.0.0.0 PORT=3001 PIX2TEXT_PYTHON_BIN=/path/to/python npm run serve:prod
```

Then open `http://<server-hostname>:3001`.

Useful environment variables:

- `HOST`: bind address for the Express server, for example `0.0.0.0`
- `PORT`: backend and production web port
- `PIX2TEXT_PYTHON_BIN`: Python binary with the Pix2Text dependencies installed
- `PIX2TEXT_MODEL_NAME`: formula model name, default `mfr-1.5`
- `PIX2TEXT_MODEL_BACKEND`: model backend, default `onnx`
- `PIX2TEXT_MODEL_DIR`: optional local model directory
- `PIX2TEXT_ROOT`: optional root directory for downloaded Pix2Text models
- `PIX2TEXT_DEVICE`: optional inference device such as `cpu`, `cuda`, or `mps`
- `PIX2TEXT_PROVIDER`: optional ONNX Runtime provider such as `CPUExecutionProvider` or `CUDAExecutionProvider`
- `PIX2TEXT_REC_CONFIG`: optional JSON generation config passed to Pix2Text
- `VITE_HOST`, `VITE_PORT`, `VITE_BACKEND_URL`: dev-mode overrides for remote Vite usage

## Notes

- `npm run start:server` automatically resolves the `talk_sketch` conda environment if it exists.
- The first recognition request is slower because Pix2Text may need to initialize and download model files.
- Chat responses still require an OpenAI API key in the app UI.

## Useful Commands

```bash
npm run dev
npm run build
npm run clean
npm run start:server
npm run serve:prod
```
